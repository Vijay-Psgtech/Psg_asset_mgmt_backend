const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateAssetTagIndexes } = require('../scripts/migrateAssetTagIndexes');

test('asset tag index migration replaces compound uniqueness with global uniqueness', async () => {
  let indexes = [
    { name: '_id_', key: { _id: 1 }, unique: true },
    { name: 'assetTag_1', key: { assetTag: 1 }, unique: true },
    {
      name: 'institution_1_assetTag_1',
      key: { institution: 1, assetTag: 1 },
      unique: true,
    },
  ];
  const dropped = [];
  const created = [];
  const collection = {
    async indexes() { return indexes; },
    async dropIndex(name) {
      dropped.push(name);
      indexes = indexes.filter((index) => index.name !== name);
    },
    async createIndex(key, options) {
      created.push({ key, options });
      indexes.push({ name: options.name, key, unique: Boolean(options.unique) });
    },
  };

  const result = await migrateAssetTagIndexes(collection);

  assert.deepEqual(result, { changedIndex: true });
  assert.deepEqual(dropped, ['institution_1_assetTag_1']);
  assert.deepEqual(created, []);
  assert.ok(indexes.some((index) => index.unique && index.key.assetTag === 1 && Object.keys(index.key).length === 1));
  assert.ok(!indexes.some((index) => index.key.institution === 1));
});

test('asset tag index migration is safe to rerun after completion', async () => {
  let indexes = [
    { name: '_id_', key: { _id: 1 }, unique: true },
    { name: 'assetTag_1', key: { assetTag: 1 }, unique: true },
  ];
  let mutationCount = 0;
  const collection = {
    async indexes() { return indexes; },
    async dropIndex() { mutationCount += 1; },
    async createIndex() { mutationCount += 1; },
  };

  const result = await migrateAssetTagIndexes(collection);

  assert.deepEqual(result, { changedIndex: false });
  assert.equal(mutationCount, 0);
});
