const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { createWriteStream } = require('node:fs');
const {
  encryptedBackupStream,
  localMongoDatabase,
  parseEncryptionKey,
} = require('../utils/encryptedBackup');
const logger = require('../utils/logger');

const backupPattern = /^asset-manager-\d{8}T\d{6}Z-[a-f0-9]{6}\.ambak$/;

function getPositiveInteger(value, name, fallback) {
  const number = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
  return number;
}

function timestampForFile(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function waitForProcess(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`mongodump failed with exit code ${code}`));
    });
  });
}

async function removeExpiredBackups(directory, retentionDays, now = Date.now()) {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !backupPattern.test(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    const stats = await fs.promises.stat(filePath);
    if (stats.mtimeMs < cutoff) {
      await fs.promises.unlink(filePath);
      removed += 1;
    }
  }
  return removed;
}

async function backupDatabase(env = process.env) {
  const sourceUri = env.BACKUP_SOURCE_URI || env.MONGO_URI;
  if (!sourceUri) throw new Error('BACKUP_SOURCE_URI or MONGO_URI is required');
  const database = localMongoDatabase(sourceUri);
  const key = parseEncryptionKey(env.BACKUP_ENCRYPTION_KEY);
  const retentionDays = getPositiveInteger(env.BACKUP_RETENTION_DAYS, 'BACKUP_RETENTION_DAYS', 15);
  const backupDirectory = path.resolve(env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
  const executable = env.MONGODUMP_BIN || 'mongodump';
  const configDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'asset-manager-mongodump-'));
  const configPath = path.join(configDirectory, 'mongodump.yml');
  const now = new Date();
  const filename = `asset-manager-${timestampForFile(now)}-${crypto.randomBytes(3).toString('hex')}.ambak`;
  const outputPath = path.join(backupDirectory, filename);
  const partialPath = `${outputPath}.partial`;

  try {
    await fs.promises.mkdir(backupDirectory, { recursive: true });
    await fs.promises.writeFile(configPath, `uri: ${JSON.stringify(sourceUri)}\n`, { mode: 0o600, flag: 'wx' });
    const child = spawn(executable, ['--config', configPath, '--archive', '--gzip', '--quiet'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const processExit = waitForProcess(child);
    try {
      await Promise.all([
        pipeline(
          encryptedBackupStream(child.stdout, key, { database, createdAt: now.toISOString() }),
          createWriteStream(partialPath, { flags: 'wx', mode: 0o600 })
        ),
        processExit,
      ]);
    } catch (error) {
      if (child.exitCode === null) child.kill();
      await processExit.catch(() => {});
      throw error;
    }
    await fs.promises.rename(partialPath, outputPath);
    const removed = await removeExpiredBackups(backupDirectory, retentionDays);
    const stats = await fs.promises.stat(outputPath);
    logger.info('database_backup_created', { filename, sizeBytes: stats.size, removedExpiredBackups: removed });
  } catch (error) {
    await fs.promises.rm(partialPath, { force: true });
    throw error;
  } finally {
    await fs.promises.rm(configDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  require('dotenv').config();
  backupDatabase().catch((error) => {
    logger.error('database_backup_failed', {
      errorName: error.name || 'Error',
      errorCode: error.code,
    });
    process.exitCode = 1;
  });
}

module.exports = { backupDatabase, removeExpiredBackups };
