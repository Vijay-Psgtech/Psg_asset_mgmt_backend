const test = require('node:test');
const assert = require('node:assert/strict');
const Asset = require('../models/Asset');
const { nextAssetTag, nextAvailableAssetTag } = require('../utils/assetTag');

test('asset tag sequence is based on the largest numeric tag across institutions', async () => {
  const originalAggregate = Asset.aggregate;
  let pipeline;
  Asset.aggregate = async (value) => {
    pipeline = value;
    return [{ numericSuffix: 1000000 }];
  };

  try {
    assert.equal(await nextAssetTag({ institutionId: 'institution-1' }), 'AST-1000001');
  } finally {
    Asset.aggregate = originalAggregate;
  }

  assert.deepEqual(pipeline[0], {
    $match: { assetTag: /^AST-\d+$/ },
  });
  assert.deepEqual(pipeline.at(-1), { $limit: 1 });
});

test('next available asset tag skips tags already used in the institution', async () => {
  const originalAggregate = Asset.aggregate;
  const originalExists = Asset.exists;
  Asset.aggregate = async () => [{ numericSuffix: 0 }];
  let checked = 0;
  Asset.exists = async () => {
    checked += 1;
    return checked === 1 ? { _id: 'existing' } : null;
  };

  try {
    assert.equal(await nextAvailableAssetTag({ institutionId: 'institution-1' }), 'AST-000002');
  } finally {
    Asset.aggregate = originalAggregate;
    Asset.exists = originalExists;
  }
});
