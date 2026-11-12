const QRCode = require('qrcode');
const Asset = require('../models/Asset');
const { nextAssetTag } = require('../utils/assetTag');
const { CATEGORIES, STATUSES } = require('../models/Asset');
const { ValidationError, ConflictError, ForbiddenError } = require('../utils/errors');
const { scopeInstitution } = require('../utils/institutionScope');

const IMPORTABLE_FIELDS = [
  'assetTag',
  'name',
  'category',
  'brand',
  'model',
  'serialNumber',
  'status',
  'purchaseDate',
  'purchaseCost',
  'vendor',
  'warrantyExpiry',
  'location',
  'notes',
];

exports.importAssets = async (req, res, next) => {
  let importStage = 'validate_batch';
  let recordNumber;
  try {
    const body = req.body || {};
    const records = Array.isArray(body) ? body : body.assets;
    if (!Array.isArray(records) || !records.length) {
      throw new ValidationError('assets must be a non-empty array');
    }
    if (records.length > 500) {
      throw new ValidationError('Import is limited to 500 assets per request');
    }
    const tenantFilter = scopeInstitution(req, {});
    const institutionId = tenantFilter.institution || body.institutionId;
    if (!institutionId) throw new ForbiddenError('Select an institution before importing assets');

    const preparedRecords = [];
    const requestedTags = new Set();
    for (const [index, record] of records.entries()) {
      recordNumber = index + 1;
      if (
        !record
        || typeof record !== 'object'
        || Array.isArray(record)
        || typeof record.name !== 'string'
        || !record.name.trim()
        || !CATEGORIES.includes(record.category)
      ) {
        throw new ValidationError('Each asset requires a name and valid category');
      }
      if (record.status && !STATUSES.includes(record.status)) {
        throw new ValidationError(`Invalid asset status: ${record.status}`);
      }
      const importedFields = Object.fromEntries(IMPORTABLE_FIELDS
        .filter((field) => record[field] !== undefined)
        .map((field) => [field, record[field]]));
      if (importedFields.assetTag) {
        if (typeof importedFields.assetTag !== 'string' || !importedFields.assetTag.trim()) {
          throw new ValidationError('Asset tags must be non-empty strings');
        }
        importedFields.assetTag = importedFields.assetTag.trim();
        if (requestedTags.has(importedFields.assetTag)) {
          throw new ConflictError(`Duplicate asset tag in import: ${importedFields.assetTag}`);
        }
        requestedTags.add(importedFields.assetTag);
      }
      const validationAsset = new Asset({
        ...importedFields,
        institution: institutionId,
        assetTag: importedFields.assetTag || 'AST-000001',
        createdBy: req.user._id,
      });
      await validationAsset.validate();
      preparedRecords.push(importedFields);
    }

    importStage = 'allocate_asset_tags';
    const firstGeneratedTag = await nextAssetTag({ institutionId });
    const firstGeneratedNumber = Number(firstGeneratedTag.slice('AST-'.length));
    if (!Number.isSafeInteger(firstGeneratedNumber) || firstGeneratedNumber < 1) {
      throw new Error('Could not allocate a valid asset tag sequence');
    }

    let nextGeneratedNumber = firstGeneratedNumber;
    for (const importedFields of preparedRecords) {
      if (importedFields.assetTag) continue;
      let candidate;
      do {
        candidate = `AST-${String(nextGeneratedNumber).padStart(6, '0')}`;
        nextGeneratedNumber += 1;
      } while (requestedTags.has(candidate));
      requestedTags.add(candidate);
      importedFields.assetTag = candidate;
    }

    if (requestedTags.size) {
      importStage = 'check_asset_tag_conflicts';
      const existingAssets = await Asset.find({
        institution: institutionId,
        assetTag: { $in: [...requestedTags] },
      }).select('assetTag').lean();
      if (existingAssets.length) {
        const duplicates = existingAssets.map((asset) => asset.assetTag);
        throw new ConflictError(`Asset tags already exist for this institution: ${duplicates.join(', ')}`);
      }
    }

    const assets = [];
    importStage = 'persist_assets';
    for (const [index, importedFields] of preparedRecords.entries()) {
      recordNumber = index + 1;
      importStage = 'prepare_asset';
      const assetTag = importedFields.assetTag;
      const asset = new Asset({ ...importedFields, institution: institutionId, assetTag, createdBy: req.user._id });
      importStage = 'generate_qr_code';
      asset.qrCode = await QRCode.toDataURL(JSON.stringify({ assetTag, id: asset._id.toString() }), { margin: 1, width: 300 });
      importStage = 'save_asset';
      await asset.save();
      assets.push(asset);
    }
    importStage = 'respond';
    res.status(201).json({ imported: assets.length, assets });
  } catch (error) {
    error.diagnosticContext = {
      operation: 'asset_import',
      stage: importStage,
      ...(recordNumber ? { recordNumber } : {}),
    };
    if (error.name === 'ValidationError') {
      const details = Object.values(error.errors || {}).map(({ path: field, message }) => ({ path: field, message }));
      return next(new ValidationError('Imported asset data failed validation', details));
    }
    if (error.name === 'CastError') {
      return next(new ValidationError(`Invalid value for ${error.path}`, [{ path: error.path, message: error.message }]));
    }
    if (error.code === 11000) {
      return next(new ConflictError('An asset tag already exists for this institution. Check the import and try again.'));
    }
    return next(error);
  }
};
