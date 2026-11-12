const test = require('node:test');
const assert = require('node:assert/strict');
const Asset = require('../models/Asset');
const QRCode = require('qrcode');
const { ValidationError, ConflictError } = require('../utils/errors');
const importController = require('../controllers/importController');

const institutionId = '64f8ff7f2e7f6d0012345678';
const userId = '64f8ff7f2e7f6d0098765432';

function createRequest(assets) {
  return {
    user: { _id: userId, role: 'admin', institution: institutionId },
    body: { assets },
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

function mockNoExistingAssetTags() {
  const originalFind = Asset.find;
  const originalAggregate = Asset.aggregate;
  Asset.find = () => ({
    select() {
      return this;
    },
    lean: async () => [],
  });
  Asset.aggregate = async () => [{ numericSuffix: 0 }];
  return () => {
    Asset.find = originalFind;
    Asset.aggregate = originalAggregate;
  };
}

test('asset import validates every record before saving any records', async () => {
  const originalSave = Asset.prototype.save;
  const restoreFind = mockNoExistingAssetTags();
  let saveCount = 0;
  let controllerError;
  Asset.prototype.save = async function save() {
    saveCount += 1;
    return this;
  };

  try {
    await importController.importAssets(
      createRequest([
        { assetTag: 'AST-TEST-001', name: 'Valid asset', category: 'Laptop' },
        { name: 'Invalid asset', category: 'Laptop', purchaseCost: 'not-a-number' },
      ]),
      createResponse(),
      (error) => { controllerError = error; }
    );
  } finally {
    Asset.prototype.save = originalSave;
    restoreFind();
  }

  assert.ok(controllerError instanceof ValidationError);
  assert.equal(controllerError.status, 400);
  assert.equal(controllerError.message, 'Imported asset data failed validation');
  assert.ok(controllerError.details.some((detail) => detail.path === 'purchaseCost'));
  assert.equal(saveCount, 0, 'Invalid batches must not partially persist earlier records');
});

test('asset import rejects duplicate tags within one batch with a conflict', async () => {
  const originalSave = Asset.prototype.save;
  const restoreFind = mockNoExistingAssetTags();
  let saveCount = 0;
  let controllerError;
  Asset.prototype.save = async function save() {
    saveCount += 1;
    return this;
  };

  try {
    await importController.importAssets(
      createRequest([
        { assetTag: 'AST-TEST-001', name: 'First asset', category: 'Laptop' },
        { assetTag: 'AST-TEST-001', name: 'Second asset', category: 'Monitor' },
      ]),
      createResponse(),
      (error) => { controllerError = error; }
    );
  } finally {
    Asset.prototype.save = originalSave;
    restoreFind();
  }

  assert.ok(controllerError instanceof ConflictError);
  assert.equal(controllerError.status, 409);
  assert.equal(saveCount, 0);
});

test('asset import converts database duplicate-key errors to a conflict response', async () => {
  const originalSave = Asset.prototype.save;
  const restoreFind = mockNoExistingAssetTags();
  let controllerError;
  Asset.prototype.save = async function save() {
    const error = new Error('duplicate key');
    error.code = 11000;
    throw error;
  };

  try {
    await importController.importAssets(
      createRequest([{ assetTag: 'AST-TEST-001', name: 'Duplicate asset', category: 'Laptop' }]),
      createResponse(),
      (error) => { controllerError = error; }
    );
  } finally {
    Asset.prototype.save = originalSave;
    restoreFind();
  }

  assert.ok(controllerError instanceof ConflictError);
  assert.equal(controllerError.status, 409);
});

test('asset import allocates distinct tags around supplied tags and checks existing conflicts', async () => {
  const originalAggregate = Asset.aggregate;
  const originalFind = Asset.find;
  const originalSave = Asset.prototype.save;
  const originalToDataURL = QRCode.toDataURL;
  let savedTags = [];
  let requestedTags = [];
  Asset.aggregate = async () => [{ numericSuffix: 10 }];
  Asset.find = (query) => {
    requestedTags = query.assetTag.$in;
    return {
      select() { return this; },
      lean: async () => [],
    };
  };
  Asset.prototype.save = async function save() {
    savedTags.push(this.assetTag);
    return this;
  };
  QRCode.toDataURL = async () => 'data:image/png;base64,test';
  const response = createResponse();
  let controllerError;

  try {
    await importController.importAssets(
      createRequest([
        { name: 'Generated one', category: 'Laptop' },
        { assetTag: 'AST-000011', name: 'Custom tag', category: 'Monitor' },
        { name: 'Generated two', category: 'Phone' },
      ]),
      response,
      (error) => { controllerError = error; }
    );
  } finally {
    Asset.aggregate = originalAggregate;
    Asset.find = originalFind;
    Asset.prototype.save = originalSave;
    QRCode.toDataURL = originalToDataURL;
  }

  assert.equal(controllerError, undefined);
  assert.deepEqual(savedTags, ['AST-000012', 'AST-000011', 'AST-000013']);
  assert.deepEqual([...requestedTags].sort(), [...savedTags].sort());
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.imported, 3);
});

test('asset import rejects tags that already exist before saving the batch', async () => {
  const originalFind = Asset.find;
  const originalAggregate = Asset.aggregate;
  const originalSave = Asset.prototype.save;
  let saveCount = 0;
  let controllerError;
  Asset.find = () => ({
    select() { return this; },
    lean: async () => [{ assetTag: 'AST-TEST-001' }],
  });
  Asset.aggregate = async () => [{ numericSuffix: 0 }];
  Asset.prototype.save = async function save() {
    saveCount += 1;
    return this;
  };

  try {
    await importController.importAssets(
      createRequest([{ assetTag: 'AST-TEST-001', name: 'Existing tag', category: 'Laptop' }]),
      createResponse(),
      (error) => { controllerError = error; }
    );
  } finally {
    Asset.find = originalFind;
    Asset.aggregate = originalAggregate;
    Asset.prototype.save = originalSave;
  }

  assert.ok(controllerError instanceof ConflictError);
  assert.equal(controllerError.status, 409);
  assert.equal(saveCount, 0);
});

test('asset import adds operation and record context to unexpected failures', async () => {
  const originalToDataURL = QRCode.toDataURL;
  const restoreFind = mockNoExistingAssetTags();
  let controllerError;
  QRCode.toDataURL = async () => {
    throw new Error('QR encoder failed');
  };

  try {
    await importController.importAssets(
      createRequest([{ assetTag: 'AST-TEST-001', name: 'QR failure asset', category: 'Laptop' }]),
      createResponse(),
      (error) => { controllerError = error; }
    );
  } finally {
    QRCode.toDataURL = originalToDataURL;
    restoreFind();
  }

  assert.equal(controllerError.message, 'QR encoder failed');
  assert.deepEqual(controllerError.diagnosticContext, {
    operation: 'asset_import',
    stage: 'generate_qr_code',
    recordNumber: 1,
  });
});
