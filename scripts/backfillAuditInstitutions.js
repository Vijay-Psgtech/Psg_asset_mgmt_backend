const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

const sourceModels = {
  Asset: require('../models/Asset'),
  Assignment: require('../models/Assignment'),
  Maintenance: require('../models/Maintenance'),
};
const batchSize = 500;

function getSourceModel(entityType) {
  return sourceModels[entityType] || null;
}

function getSourceInstitution(source) {
  return source?.institution?._id || source?.institution || null;
}

async function backfillAuditInstitutions({ apply = false } = {}) {
  const counts = { scanned: 0, eligible: 0, updated: 0, unresolved: 0 };
  let batch = [];

  const processBatch = async (records) => {
    const recordsByType = new Map();
    for (const record of records) {
      const Model = getSourceModel(record.entityType);
      if (!Model || !record.entityId) {
        counts.unresolved += 1;
        continue;
      }
      if (!recordsByType.has(record.entityType)) recordsByType.set(record.entityType, []);
      recordsByType.get(record.entityType).push(record);
    }

    for (const [entityType, typedRecords] of recordsByType) {
      const Model = getSourceModel(entityType);
      const entities = await Model.find({
        _id: { $in: typedRecords.map((record) => record.entityId) },
      }).select('_id institution').lean();
      const institutionsByEntity = new Map(
        entities
          .filter((entity) => getSourceInstitution(entity))
          .map((entity) => [entity._id.toString(), getSourceInstitution(entity)])
      );
      const operations = [];

      for (const record of typedRecords) {
        const institution = institutionsByEntity.get(record.entityId.toString());
        if (!institution) {
          counts.unresolved += 1;
          continue;
        }
        counts.eligible += 1;
        operations.push({
          updateOne: {
            filter: { _id: record._id, institution: null },
            update: { $set: { institution } },
          },
        });
      }

      if (apply && operations.length) {
        const result = await AuditLog.bulkWrite(operations, { ordered: false });
        counts.updated += result.modifiedCount;
      }
    }
  };

  const cursor = AuditLog.find({
    $or: [{ institution: { $exists: false } }, { institution: null }],
  }).sort({ _id: 1 }).lean().cursor({ batchSize });

  for await (const record of cursor) {
    counts.scanned += 1;
    batch.push(record);
    if (batch.length === batchSize) {
      await processBatch(batch);
      batch = [];
    }
  }
  if (batch.length) await processBatch(batch);

  return counts;
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');

  await mongoose.connect(process.env.MONGO_URI);
  const counts = await backfillAuditInstitutions({ apply });
  logger.info('audit_institution_backfill_complete', {
    mode: apply ? 'apply' : 'dry_run',
    ...counts,
  });
  await mongoose.disconnect();
}

if (require.main === module) {
  require('dotenv').config();
  main().catch(async (err) => {
    logger.error('audit_institution_backfill_failed', {
      errorName: err.name || 'Error',
      errorCode: err.code,
    });
    await mongoose.disconnect();
    process.exitCode = 1;
  });
}

module.exports = { backfillAuditInstitutions, getSourceInstitution, getSourceModel };
