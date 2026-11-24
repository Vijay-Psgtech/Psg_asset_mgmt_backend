const QRCode = require('qrcode');
const Asset = require('../models/Asset');
const Accessory = require('../models/Accessory');
const Consumable = require('../models/Consumable');
const License = require('../models/License');
const Institution = require('../models/Institution');
const Category = require('../models/Category');
const { nextAssetTag } = require('../utils/assetTag');
const { parseCsv } = require('../utils/parseCsv');
const { ValidationError, ConflictError, ForbiddenError } = require('../utils/errors');
const { scopeInstitution } = require('../utils/institutionScope');

const IMPORT_TYPES = {
  assets: {
    model: Asset,
    required: ['name', 'category'],
    fields: {
      assetTag: 'string',
      name: 'string',
      category: 'string',
      brand: 'string',
      model: 'string',
      serialNumber: 'string',
      status: 'string',
      purchaseDate: 'date',
      purchaseCost: 'number',
      vendor: 'string',
      warrantyExpiry: 'date',
      location: 'string',
      notes: 'string',
    },
  },
  accessories: {
    model: Accessory,
    required: ['name'],
    fields: {
      name: 'string',
      category: 'string',
      manufacturer: 'string',
      modelNumber: 'string',
      totalQty: 'number',
      minQty: 'number',
      purchaseDate: 'date',
      cost: 'number',
      notes: 'string',
    },
  },
  consumables: {
    model: Consumable,
    required: ['name'],
    fields: {
      name: 'string',
      category: 'string',
      manufacturer: 'string',
      modelNumber: 'string',
      totalQty: 'number',
      minQty: 'number',
      purchaseDate: 'date',
      cost: 'number',
      notes: 'string',
    },
  },
  licenses: {
    model: License,
    required: ['name', 'seats'],
    fields: {
      name: 'string',
      licenseKey: 'string',
      vendor: 'string',
      category: 'string',
      seats: 'number',
      purchaseDate: 'date',
      expirationDate: 'date',
      cost: 'number',
      notes: 'string',
    },
  },
};

function rowValidationError(rowNumber, message, path) {
  return new ValidationError(`CSV row ${rowNumber}: ${message}`, [
    { path: path || `row ${rowNumber}`, message },
  ]);
}

function parseCsvDate(value, field, rowNumber) {
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const dayFirstDate = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  const parts = isoDate
    ? [Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3])]
    : dayFirstDate
      ? [Number(dayFirstDate[3]), Number(dayFirstDate[2]), Number(dayFirstDate[1])]
      : null;

  if (!parts) {
    throw rowValidationError(rowNumber, `${field} must use YYYY-MM-DD or DD-MM-YYYY`, field);
  }

  const [year, month, day] = parts;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw rowValidationError(rowNumber, `${field} must be a valid date`, field);
  }
  return date;
}

function convertRow(row, config, rowNumber) {
  const record = {};
  for (const [field, type] of Object.entries(config.fields)) {
    const value = row[field] === undefined ? '' : row[field].trim();
    if (!value) continue;

    if (type === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        throw rowValidationError(rowNumber, `${field} must be a valid number`, field);
      }
      record[field] = number;
    } else if (type === 'date') {
      record[field] = parseCsvDate(value, field, rowNumber);
    } else {
      record[field] = value;
    }
  }

  for (const field of config.required) {
    if (record[field] === undefined) {
      throw rowValidationError(rowNumber, `${field} is required`, field);
    }
  }
  return record;
}

function getValidationDetails(error) {
  if (error.name === 'ValidationError') {
    return Object.values(error.errors || {}).map(({ path, message }) => ({ path, message }));
  }
  if (error.name === 'CastError') {
    return [{ path: error.path, message: error.message }];
  }
  return null;
}

exports.importCsv = async (req, res, next) => {
  let importStage = 'validate_upload';
  let recordNumber;
  try {
    const config = IMPORT_TYPES[req.params.type];
    if (!config) throw new ValidationError('Choose assets, accessories, consumables, or licenses');
    if (!req.file || !Buffer.isBuffer(req.file.buffer)) {
      throw new ValidationError('Choose a CSV file to import');
    }

    importStage = 'parse_csv';
    const rows = parseCsv(req.file.buffer.toString('utf8'));
    if (rows.length < 2) throw new ValidationError('CSV must contain a header and at least one data row');
    if (rows.length - 1 > 500) throw new ValidationError('Import is limited to 500 records per CSV file');

    const headers = rows[0].map((header) => header.trim());
    const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
    if (headers.some((header) => !header)) {
      throw new ValidationError('CSV headers cannot be empty');
    }
    if (duplicateHeaders.length) {
      throw new ValidationError(`Duplicate CSV header: ${duplicateHeaders[0]}`);
    }
    const unknownHeaders = headers.filter((header) => !Object.hasOwn(config.fields, header));
    if (unknownHeaders.length) {
      throw new ValidationError(`Unsupported CSV column: ${unknownHeaders[0]}`);
    }
    const missingHeaders = config.required.filter((field) => !headers.includes(field));
    if (missingHeaders.length) {
      throw new ValidationError(`CSV is missing required column${missingHeaders.length > 1 ? 's' : ''}: ${missingHeaders.join(', ')}`);
    }

    const records = [];
    for (const [index, values] of rows.slice(1).entries()) {
      recordNumber = index + 2;
      if (values.every((value) => !value.trim())) continue;
      if (values.length > headers.length) {
        throw rowValidationError(recordNumber, 'contains more values than the header row');
      }
      const row = Object.fromEntries(headers.map((header, column) => [header, values[column] || '']));
      records.push(convertRow(row, config, recordNumber));
    }
    if (!records.length) throw new ValidationError('CSV must contain at least one non-empty data row');

    const tenantFilter = scopeInstitution(req, {}, { useCurrentInstitution: true });
    const institutionId = tenantFilter.institution;
    if (!institutionId) throw new ForbiddenError('Select an institution before importing records');
    if (req.user.role === 'superadmin'
      && !(await Institution.exists({ _id: institutionId, status: 'active' }))) {
      throw new ValidationError('The selected institution is not active or does not exist');
    }

    importStage = 'validate_records';
    const documents = [];
    const requestedTags = new Set();
    for (const [index, record] of records.entries()) {
      recordNumber = index + 2;
      const values = {
        ...record,
        institution: institutionId,
        ...(req.params.type === 'assets' ? { createdBy: req.user._id } : {}),
      };
      if (req.params.type === 'assets') {
        const category = await Category.findOne({
          name: { $regex: `^${String(record.category).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
          active: true,
        });
        if (!category) {
          throw rowValidationError(recordNumber, `Unknown or inactive asset category: ${record.category}`, 'category');
        }
        record.category = category.name;
        if (record.assetTag) {
          if (requestedTags.has(record.assetTag)) {
            throw new ConflictError(`Duplicate asset tag in CSV: ${record.assetTag}`);
          }
          requestedTags.add(record.assetTag);
        }
        values.assetTag = record.assetTag || 'AST-000001';
      }

      const document = new config.model(values);
      try {
        await document.validate();
      } catch (error) {
        const details = getValidationDetails(error);
        if (details) {
          throw new ValidationError(`CSV row ${recordNumber} failed validation`, details);
        }
        throw error;
      }
      documents.push(document);
    }

    if (req.params.type === 'assets') {
      importStage = 'allocate_asset_tags';
      const firstGeneratedTag = await nextAssetTag({ institutionId });
      const firstGeneratedNumber = Number(firstGeneratedTag.slice('AST-'.length));
      if (!Number.isSafeInteger(firstGeneratedNumber) || firstGeneratedNumber < 1) {
        throw new Error('Could not allocate a valid asset tag sequence');
      }
      let nextGeneratedNumber = firstGeneratedNumber;
      for (const [index, document] of documents.entries()) {
        if (records[index].assetTag) continue;
        let candidate;
        do {
          candidate = `AST-${String(nextGeneratedNumber).padStart(6, '0')}`;
          nextGeneratedNumber += 1;
        } while (requestedTags.has(candidate));
        requestedTags.add(candidate);
        document.assetTag = candidate;
      }

      importStage = 'check_asset_tag_conflicts';
      const existingAssets = await Asset.find({
        institution: institutionId,
        assetTag: { $in: [...requestedTags] },
      }).select('assetTag').lean();
      if (existingAssets.length) {
        throw new ConflictError(`Asset tags already exist for this institution: ${existingAssets.map((asset) => asset.assetTag).join(', ')}`);
      }
    }

    importStage = 'save_records';
    for (const [index, document] of documents.entries()) {
      recordNumber = index + 2;
      if (req.params.type === 'assets') {
        importStage = 'generate_qr_code';
        document.qrCode = await QRCode.toDataURL(
          JSON.stringify({ assetTag: document.assetTag, id: document._id.toString() }),
          { margin: 1, width: 300 }
        );
      }
      importStage = 'save_record';
      try {
        await document.save();
      } catch (error) {
        if (error.code === 11000 && req.params.type === 'assets') {
          throw new ConflictError('An asset tag already exists for this institution. Check the CSV and try again.');
        }
        const details = getValidationDetails(error);
        if (details) {
          throw new ValidationError(`CSV row ${recordNumber} failed validation`, details);
        }
        throw error;
      }
    }

    res.status(201).json({
      type: req.params.type,
      imported: documents.length,
      records: documents,
    });
  } catch (error) {
    error.diagnosticContext = {
      operation: 'csv_import',
      type: req.params.type,
      stage: importStage,
      ...(recordNumber ? { recordNumber } : {}),
    };
    return next(error);
  }
};

