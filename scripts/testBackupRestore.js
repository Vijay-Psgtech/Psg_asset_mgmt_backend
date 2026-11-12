const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const {
  decryptBackupTo,
  localMongoDatabase,
  localMongoUriForDatabase,
  parseEncryptionKey,
  readBackupHeader,
} = require('../utils/encryptedBackup');
const logger = require('../utils/logger');

function waitForProcess(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`mongorestore failed with exit code ${code}`));
    });
  });
}

async function findLatestBackup(directory) {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^asset-manager-\d{8}T\d{6}Z-[a-f0-9]{6}\.ambak$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (!files.length) throw new Error('No encrypted backup archive was found');
  return path.join(directory, files[0]);
}

async function testBackupRestore(env = process.env) {
  const restoreUri = env.BACKUP_RESTORE_URI || env.BACKUP_SOURCE_URI || env.MONGO_URI;
  if (!restoreUri) throw new Error('A local BACKUP_RESTORE_URI is required');
  localMongoDatabase(restoreUri);
  const key = parseEncryptionKey(env.BACKUP_ENCRYPTION_KEY);
  const backupDirectory = path.resolve(env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
  const backupPath = env.BACKUP_FILE
    ? path.resolve(env.BACKUP_FILE)
    : await findLatestBackup(backupDirectory);
  const { metadata } = await readBackupHeader(backupPath);
  if (metadata.database !== localMongoDatabase(restoreUri)) {
    throw new Error('The backup database must match the configured local restore database');
  }
  const databaseName = `asset_restore_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const temporaryUri = localMongoUriForDatabase(restoreUri, databaseName);
  const restoreConfigDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'asset-manager-mongorestore-'));
  const configPath = path.join(restoreConfigDirectory, 'mongorestore.yml');
  let restoreError;

  try {
    await fs.promises.writeFile(configPath, `uri: ${JSON.stringify(temporaryUri)}\n`, { mode: 0o600, flag: 'wx' });
    const child = spawn(env.MONGORESTORE_BIN || 'mongorestore', [
      '--config', configPath,
      '--archive',
      '--gzip',
      '--stopOnError',
      `--nsFrom=${metadata.database}.*`,
      `--nsTo=${databaseName}.*`,
      '--quiet',
    ], { stdio: ['pipe', 'ignore', 'ignore'] });
    const processExit = waitForProcess(child);
    try {
      await Promise.all([decryptBackupTo(backupPath, child.stdin, key), processExit]);
    } catch (error) {
      if (child.exitCode === null) child.kill();
      await processExit.catch(() => {});
      throw error;
    }
  } catch (error) {
    restoreError = error;
  }

  let collectionCount = 0;
  let cleanupError;
  try {
    const connection = await mongoose.createConnection(temporaryUri, { serverSelectionTimeoutMS: 10000 }).asPromise();
    try {
      const collections = await connection.db.listCollections().toArray();
      collectionCount = collections.length;
      if (!restoreError && collectionCount === 0) {
        restoreError = new Error('Restore completed but no collections were found');
      }
      await connection.dropDatabase();
    } finally {
      await connection.close();
    }
  } catch (error) {
    cleanupError = error;
  }

  await fs.promises.rm(restoreConfigDirectory, { recursive: true, force: true });
  if (restoreError) throw restoreError;
  if (cleanupError) throw new Error('Could not verify or remove the temporary restore database');
  logger.info('database_backup_restore_test_passed', { collectionCount });
}

if (require.main === module) {
  require('dotenv').config();
  testBackupRestore().catch((error) => {
    logger.error('database_backup_restore_test_failed', {
      errorName: error.name || 'Error',
      errorCode: error.code,
    });
    process.exitCode = 1;
  });
}

module.exports = { findLatestBackup, testBackupRestore };
