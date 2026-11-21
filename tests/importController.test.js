const test = require('node:test');
const assert = require('node:assert/strict');
const Asset = require('../models/Asset');
const Accessory = require('../models/Accessory');
const Consumable = require('../models/Consumable');
const License = require('../models/License');
const Institution = require('../models/Institution');
const QRCode = require('qrcode');
const { ValidationError, ConflictError } = require('../utils/errors');
const { parseCsv } = require('../utils/parseCsv');
const importController = require('../controllers/importController');

const institutionId = '64f8ff7f2e7f6d0012345678';
const userId = '64f8ff7f2e7f6d0098765432';

function createRequest(type, csv, role = 'admin') {
  return {
    params: { type },
    user: { _id: userId, role, institution: institutionId },
    body: {},
    file: { buffer: Buffer.from(csv), originalname: 'inventory.csv' },
  };
}

function createResponse() {
  return {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
}

test('CSV parser supports BOMs, escaped quotes, and embedded newlines', () => {
  assert.deepEqual(
    parseCsv('\uFEFFname,notes\r\n"Device, Pro","line one\r\nsaid ""hello"""'),
    [['name', 'notes'], ['Device, Pro', 'line one\r\nsaid "hello"']]
  );
});

test('CSV parser rejects malformed quoted cells', () => {
  assert.throws(() => parseCsv('name,notes\nLaptop,"unfinished'), ValidationError);
  assert.throws(() => parseCsv('name,notes\nLaptop,"ok"x'), ValidationError);
});

test('asset CSV imports assign trusted tenant metadata and generate tags and QR codes', async () => {
  const originalSave = Asset.prototype.save;
  const originalFind = Asset.find;
  const originalAggregate = Asset.aggregate;
  const originalToDataURL = QRCode.toDataURL;
  const response = createResponse();
  let controllerError;
  let savedAsset;
  Asset.prototype.save = async function save() { savedAsset = this; return this; };
  Asset.find = () => ({
    select() { return this; },
    lean: async () => [],
  });
  Asset.aggregate = async () => [{ numericSuffix: 0 }];
  QRCode.toDataURL = async () => 'data:image/png;base64,test';

  try {
    await importController.importCsv(
      createRequest('assets', 'name,category\nLaptop,Laptop'),
      response,
      (error) => { controllerError = error; }
    );
  } finally {
    Asset.prototype.save = originalSave;
    Asset.find = originalFind;
    Asset.aggregate = originalAggregate;
    QRCode.toDataURL = originalToDataURL;
  }

  assert.equal(controllerError, undefined);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.imported, 1);
  assert.equal(savedAsset.assetTag, 'AST-000001');
  assert.equal(savedAsset.institution.toString(), institutionId);
  assert.equal(savedAsset.createdBy.toString(), userId);
  assert.equal(savedAsset.qrCode, 'data:image/png;base64,test');
});

test('asset CSV imports normalize ISO and day-first dates', async () => {
  const originalSave = Asset.prototype.save;
  const originalFind = Asset.find;
  const originalAggregate = Asset.aggregate;
  const originalToDataURL = QRCode.toDataURL;
  let savedAsset;
  Asset.prototype.save = async function save() { savedAsset = this; return this; };
  Asset.find = () => ({ select() { return this; }, lean: async () => [] });
  Asset.aggregate = async () => [{ numericSuffix: 0 }];
  QRCode.toDataURL = async () => 'data:image/png;base64,test';

  try {
    await importController.importCsv(
      createRequest(
        'assets',
        'name,category,purchaseDate,warrantyExpiry\nLaptop,Laptop,2026-11-13,13-11-2027'
      ),
      createResponse(),
      (error) => { if (error) throw error; }
    );
  } finally {
    Asset.prototype.save = originalSave;
    Asset.find = originalFind;
    Asset.aggregate = originalAggregate;
    QRCode.toDataURL = originalToDataURL;
  }

  assert.equal(savedAsset.purchaseDate.toISOString(), '2026-11-13T00:00:00.000Z');
  assert.equal(savedAsset.warrantyExpiry.toISOString(), '2027-11-13T00:00:00.000Z');
});

test('CSV imports reject impossible dates with a row-specific validation error', async () => {
  let controllerError;
  await importController.importCsv(
    createRequest('assets', 'name,category,purchaseDate\nLaptop,Laptop,31-02-2026'),
    createResponse(),
    (error) => { controllerError = error; }
  );

  assert.ok(controllerError instanceof ValidationError);
  assert.match(controllerError.message, /CSV row 2: purchaseDate must be a valid date/);
  assert.equal(controllerError.details[0].path, 'purchaseDate');
});

test('accessory, consumable, and license CSV files import into their selected models', async () => {
  const models = [
    { type: 'accessories', model: Accessory, csv: 'name,totalQty,minQty,cost\nUSB-C Dock,12,2,49.95' },
    { type: 'consumables', model: Consumable, csv: 'name,totalQty,minQty\nToner,30,4' },
    { type: 'licenses', model: License, csv: 'name,seats,cost\nDesign Suite,25,1200' },
  ];

  for (const { type, model, csv } of models) {
    const originalSave = model.prototype.save;
    let savedDocument;
    const response = createResponse();
    let controllerError;
    model.prototype.save = async function save() { savedDocument = this; return this; };
    try {
      await importController.importCsv(createRequest(type, csv), response, (error) => { controllerError = error; });
    } finally {
      model.prototype.save = originalSave;
    }

    assert.equal(controllerError, undefined, `${type} import should succeed`);
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.type, type);
    assert.equal(response.body.imported, 1);
    assert.equal(savedDocument.institution.toString(), institutionId);
    assert.equal(savedDocument.totalQty, type === 'licenses' ? undefined : (type === 'accessories' ? 12 : 30));
  }
});

test('superadmin CSV imports use the selected active institution', async () => {
  const originalSave = Accessory.prototype.save;
  const originalExists = Institution.exists;
  const selectedInstitutionId = '64f8ff7f2e7f6d0012345680';
  let savedDocument;
  let checkedInstitution;
  const request = createRequest('accessories', 'name\nUSB-C Dock', 'superadmin');
  request.body.institutionId = selectedInstitutionId;
  Accessory.prototype.save = async function save() { savedDocument = this; return this; };
  Institution.exists = async (filter) => {
    checkedInstitution = filter;
    return true;
  };

  try {
    await importController.importCsv(request, createResponse(), (error) => { if (error) throw error; });
  } finally {
    Accessory.prototype.save = originalSave;
    Institution.exists = originalExists;
  }

  assert.deepEqual(checkedInstitution, { _id: selectedInstitutionId, status: 'active' });
  assert.equal(savedDocument.institution.toString(), selectedInstitutionId);
});

test('CSV headers are validated before any records are saved', async () => {
  const originalSave = Accessory.prototype.save;
  let saveCount = 0;
  let controllerError;
  Accessory.prototype.save = async function save() { saveCount += 1; return this; };

  try {
    await importController.importCsv(
      createRequest('accessories', 'name,unknownColumn\nUSB-C Dock,anything'),
      createResponse(),
      (error) => { controllerError = error; }
    );
  } finally {
    Accessory.prototype.save = originalSave;
  }

  assert.ok(controllerError instanceof ValidationError);
  assert.match(controllerError.message, /Unsupported CSV column/);
  assert.equal(saveCount, 0);
});

test('invalid model data rejects the full batch before the first save', async () => {
  const originalSave = Accessory.prototype.save;
  let saveCount = 0;
  let controllerError;
  Accessory.prototype.save = async function save() { saveCount += 1; return this; };

  try {
    await importController.importCsv(
      createRequest('accessories', 'name,totalQty\nValid,4\nInvalid,-1'),
      createResponse(),
      (error) => { controllerError = error; }
    );
  } finally {
    Accessory.prototype.save = originalSave;
  }

  assert.ok(controllerError instanceof ValidationError);
  assert.match(controllerError.message, /CSV row 3 failed validation/);
  assert.equal(saveCount, 0);
});

test('asset imports reject duplicate tags in the CSV before saving', async () => {
  const originalFind = Asset.find;
  const originalAggregate = Asset.aggregate;
  const originalSave = Asset.prototype.save;
  let saveCount = 0;
  let controllerError;
  Asset.find = () => ({ select() { return this; }, lean: async () => [] });
  Asset.aggregate = async () => [{ numericSuffix: 0 }];
  Asset.prototype.save = async function save() { saveCount += 1; return this; };

  try {
    await importController.importCsv(
      createRequest('assets', 'assetTag,name,category\nAST-TEST-1,First,Laptop\nAST-TEST-1,Second,Monitor'),
      createResponse(),
      (error) => { controllerError = error; }
    );
  } finally {
    Asset.find = originalFind;
    Asset.aggregate = originalAggregate;
    Asset.prototype.save = originalSave;
  }

  assert.ok(controllerError instanceof ConflictError);
  assert.equal(saveCount, 0);
});
