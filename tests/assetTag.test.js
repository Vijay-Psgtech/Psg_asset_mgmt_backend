const test = require('node:test');
const assert = require('node:assert/strict');
const Asset = require('../models/Asset');
const { nextAssetTag } = require('../utils/assetTag');

test('asset tag sequence is based on the largest numeric tag, scoped to institution', async () => {
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
    $match: { assetTag: /^AST-\d+$/, institution: 'institution-1' },
  });
  assert.deepEqual(pipeline.at(-1), { $limit: 1 });
});
