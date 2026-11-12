const mongoose = require('mongoose');

async function migrateAssetTagIndexes(collection) {
  let indexes = await collection.indexes();
  const tenantTagIndex = indexes.find((index) => (
    index.key?.institution === 1
    && index.key?.assetTag === 1
    && index.unique
  ));

  if (!tenantTagIndex) {
    await collection.createIndex(
      { institution: 1, assetTag: 1 },
      { name: 'institution_1_assetTag_1', unique: true }
    );
    indexes = await collection.indexes();
  }

  const globalTagIndex = indexes.find((index) => (
    Object.keys(index.key || {}).length === 1
    && index.key.assetTag === 1
    && index.unique
  ));
  let removedGlobalUniqueIndex = false;
  if (globalTagIndex) {
    await collection.dropIndex(globalTagIndex.name);
    removedGlobalUniqueIndex = true;
    indexes = indexes.filter((index) => index.name !== globalTagIndex.name);
  }

  const tagLookupIndex = indexes.find((index) => (
    Object.keys(index.key || {}).length === 1
    && index.key.assetTag === 1
  ));
  if (!tagLookupIndex) {
    await collection.createIndex({ assetTag: 1 }, { name: 'assetTag_1' });
  }

  return { removedGlobalUniqueIndex };
}

async function main() {
  require('dotenv').config();
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured');

  await mongoose.connect(process.env.MONGO_URI);
  const result = await migrateAssetTagIndexes(mongoose.connection.collection('assets'));
  console.log(JSON.stringify({
    event: 'asset_tag_indexes_migrated',
    database: mongoose.connection.name,
    ...result,
    tenantTagUniqueness: 'institution_and_assetTag',
  }));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(JSON.stringify({
        event: 'asset_tag_index_migration_failed',
        errorName: error.name || 'Error',
        errorCode: error.code,
      }));
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { migrateAssetTagIndexes };
