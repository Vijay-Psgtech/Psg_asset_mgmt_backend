const mongoose = require('mongoose');

function buildGlobalCustomFieldPlan(documents) {
  const grouped = new Map();
  for (const document of documents) {
    if (typeof document.key !== 'string' || !document.key) {
      throw new Error(`Custom field ${document._id} has no valid key`);
    }
    const definition = {
      label: document.label,
      type: document.type,
      options: Array.isArray(document.options) ? document.options : [],
      required: document.required ?? false,
      active: document.active ?? true,
    };
    const signature = JSON.stringify(definition);
    const group = grouped.get(document.key) || { key: document.key, signature, definition, documents: [] };
    if (group.signature !== signature) {
      group.conflict = true;
    }
    group.documents.push(document);
    grouped.set(document.key, group);
  }

  const conflicts = [...grouped.values()].filter((group) => group.conflict);
  if (conflicts.length) {
    throw new Error(`Conflicting definitions for custom field keys: ${conflicts.map((group) => group.key).join(', ')}`);
  }

  return [...grouped.values()].map((group) => ({
    key: group.key,
    canonical: group.documents[0],
    duplicates: group.documents.slice(1),
    definition: group.definition,
    categories: [...new Set(group.documents.flatMap((document) => document.categories || []))],
    categoriesAdded: Math.max(0, new Set(group.documents.flatMap((document) => document.categories || [])).size
      - new Set(group.documents[0].categories || []).size),
  }));
}

async function migrateCustomFieldsGlobal(collection) {
  const documents = await collection.find({}).sort({ createdAt: 1, _id: 1 }).toArray();
  const plan = buildGlobalCustomFieldPlan(documents);

  for (const group of plan) {
    await collection.updateOne(
      { _id: group.canonical._id },
      { $set: { categories: group.categories } }
    );
    if (group.duplicates.length) {
      await collection.deleteMany({ _id: { $in: group.duplicates.map((document) => document._id) } });
    }
    await collection.updateOne(
      { _id: group.canonical._id },
      { $unset: { institution: '' } }
    );
  }

  const indexes = await collection.indexes();
  for (const index of indexes) {
    const keys = Object.keys(index.key || {});
    const obsoleteInstitutionIndex = Object.prototype.hasOwnProperty.call(index.key || {}, 'institution');
    const obsoleteNonUniqueKeyIndex = keys.length === 1 && index.key.key === 1 && !index.unique;
    if (index.name !== '_id_' && (obsoleteInstitutionIndex || obsoleteNonUniqueKeyIndex)) {
      await collection.dropIndex(index.name);
    }
  }

  await collection.createIndex({ key: 1 }, { name: 'key_1', unique: true });
  return {
    definitions: plan.length,
    mergedDefinitions: plan.reduce((count, group) => count + group.duplicates.length, 0),
    categoriesAdded: plan.reduce((count, group) => count + group.categoriesAdded, 0),
  };
}

async function main() {
  require('dotenv').config();
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured');

  await mongoose.connect(process.env.MONGO_URI);
  const collections = await mongoose.connection.db.listCollections({ name: 'customfields' }).toArray();
  if (!collections.length) await mongoose.connection.db.createCollection('customfields');
  const result = await migrateCustomFieldsGlobal(mongoose.connection.collection('customfields'));
  console.log(JSON.stringify({
    event: 'custom_fields_global_migration_complete',
    database: mongoose.connection.name,
    ...result,
  }));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(JSON.stringify({
        event: 'custom_fields_global_migration_failed',
        message: error.message,
        errorName: error.name || 'Error',
        errorCode: error.code,
      }));
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { buildGlobalCustomFieldPlan, migrateCustomFieldsGlobal };
