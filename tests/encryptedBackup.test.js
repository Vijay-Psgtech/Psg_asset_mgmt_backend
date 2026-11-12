const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createWriteStream } = require('node:fs');
const {
  decryptBackupTo,
  encryptedBackupStream,
  localMongoDatabase,
  localMongoUriForDatabase,
  parseEncryptionKey,
  readBackupHeader,
} = require('../utils/encryptedBackup');
const { backupDatabase, removeExpiredBackups } = require('../scripts/backupDatabase');

test('encrypted backup round-trips and authenticates metadata and payload', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'asset-manager-backup-test-'));
  const archivePath = path.join(directory, 'test.ambak');
  const tamperedPayloadPath = path.join(directory, 'tampered-payload.ambak');
  const tamperedMetadataPath = path.join(directory, 'tampered-metadata.ambak');
  const key = crypto.randomBytes(32);
  const payload = Buffer.from('small staging backup fixture');
  const metadata = { database: 'asset-manager-test', createdAt: new Date().toISOString() };

  try {
    await pipeline(
      encryptedBackupStream(Readable.from([payload]), key, metadata),
      createWriteStream(archivePath, { flags: 'wx' })
    );

    const header = await readBackupHeader(archivePath);
    assert.deepEqual(header.metadata, metadata);
    const output = new PassThrough();
    const outputChunks = [];
    output.on('data', (chunk) => outputChunks.push(chunk));
    const decryptedMetadata = await decryptBackupTo(archivePath, output, key);
    assert.deepEqual(decryptedMetadata, metadata);
    assert.deepEqual(Buffer.concat(outputChunks), payload);

    const tamperedPayload = await fs.promises.readFile(archivePath);
    tamperedPayload[header.ciphertextStart] ^= 1;
    await fs.promises.writeFile(tamperedPayloadPath, tamperedPayload, { flag: 'wx' });
    await assert.rejects(decryptBackupTo(tamperedPayloadPath, new PassThrough(), key));

    const tamperedMetadata = await fs.promises.readFile(archivePath);
    const metadataLength = tamperedMetadata.readUInt32BE(8);
    const metadataStart = 12;
    const databaseStart = tamperedMetadata
      .subarray(metadataStart, metadataStart + metadataLength)
      .indexOf(Buffer.from('asset-manager-test'));
    tamperedMetadata[metadataStart + databaseStart] ^= 1;
    await fs.promises.writeFile(tamperedMetadataPath, tamperedMetadata, { flag: 'wx' });
    await assert.rejects(decryptBackupTo(tamperedMetadataPath, new PassThrough(), key));
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test('backup retention removes only expired managed archive files', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'asset-manager-retention-test-'));
  const oldBackup = path.join(directory, 'asset-manager-20260101T000000Z-aabbcc.ambak');
  const recentBackup = path.join(directory, 'asset-manager-20260102T000000Z-ddeeff.ambak');
  const unrelatedFile = path.join(directory, 'keep.txt');
  const now = Date.now();

  try {
    await Promise.all([
      fs.promises.writeFile(oldBackup, 'old'),
      fs.promises.writeFile(recentBackup, 'recent'),
      fs.promises.writeFile(unrelatedFile, 'keep'),
    ]);
    const expiredAt = new Date(now - 16 * 24 * 60 * 60 * 1000);
    await fs.promises.utimes(oldBackup, expiredAt, expiredAt);

    const removed = await removeExpiredBackups(directory, 15, now);
    assert.equal(removed, 1);
    await assert.rejects(fs.promises.access(oldBackup));
    await fs.promises.access(recentBackup);
    await fs.promises.access(unrelatedFile);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test('backup configuration requires a strong key and a localhost database URI', () => {
  const key = crypto.randomBytes(32).toString('base64');
  assert.equal(parseEncryptionKey(key).length, 32);
  assert.throws(() => parseEncryptionKey('short'), /32-byte key/);
  assert.equal(localMongoDatabase('mongodb://127.0.0.1:27017/asset-manager'), 'asset-manager');
  assert.throws(() => localMongoDatabase('mongodb://db.example.com:27017/asset-manager'), /localhost/);
  assert.match(
    localMongoUriForDatabase('mongodb://127.0.0.1:27017/asset-manager', 'asset_restore_test'),
    /\/asset_restore_test$/
  );
});

test('backup failure is explicit when MongoDB Database Tools are unavailable', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'asset-manager-backup-command-test-'));
  try {
    await assert.rejects(
      backupDatabase({
        MONGO_URI: 'mongodb://127.0.0.1:27017/asset-manager-test',
        BACKUP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
        BACKUP_DIR: path.join(directory, 'archives'),
        MONGODUMP_BIN: 'asset-manager-mongodump-not-installed',
      }),
      (error) => error.code === 'ENOENT'
    );
    assert.deepEqual(await fs.promises.readdir(path.join(directory, 'archives')), []);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
