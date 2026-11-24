const mongoose = require('mongoose');

async function migrateAssetTagIndexes(collection) {
  let indexes = await collection.indexes();
  const compoundIndexes = indexes.filter((index) => (
    index.key?.institution === 1
    && index.key?.assetTag === 1
  ));
  let changedIndex = compoundIndexes.length > 0;
  for (const index of compoundIndexes) {
    await collection.dropIndex(index.name);
    indexes = await collection.indexes();
  }

  const globalTagIndex = indexes.find((index) => (
    Object.keys(index.key || {}).length === 1
    && index.key.assetTag === 1
  ));
  if (globalTagIndex?.unique === false) {
    await collection.dropIndex(globalTagIndex.name);
    changedIndex = true;
    indexes = indexes.filter((index) => index.name !== globalTagIndex.name);
  }

  const uniqueTagIndex = indexes.find((index) => (
    Object.keys(index.key || {}).length === 1
    && index.key.assetTag === 1
    && index.unique
  ));
  if (!uniqueTagIndex) {
    await collection.createIndex(
      { assetTag: 1 },
      { name: 'assetTag_1', unique: true }
    );
    changedIndex = true;
  }

  return { changedIndex };
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
    globalTagUniqueness: true,
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
