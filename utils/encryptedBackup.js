const crypto = require('node:crypto');
const fs = require('node:fs');
const { createReadStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const MAGIC = Buffer.from('AMDBBK01');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const MAX_METADATA_LENGTH = 4096;

function parseEncryptionKey(value) {
  const encoded = String(value || '').trim();
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

function localMongoDatabase(uri) {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error('A valid local MongoDB URI is required for this backup configuration');
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !['mongodb:', 'mongodb+srv:'].includes(parsed.protocol)
    || !['localhost', '127.0.0.1', '::1'].includes(host)
  ) {
    throw new Error('Encrypted local backups only accept localhost MongoDB URIs');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!database) throw new Error('The local MongoDB URI must include a database name');
  return database;
}

function localMongoUriForDatabase(uri, database) {
  const parsed = new URL(uri);
  localMongoDatabase(uri);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

async function* encryptedBackupChunks(source, key, metadata, iv = crypto.randomBytes(IV_LENGTH)) {
  const metadataBuffer = Buffer.from(JSON.stringify(metadata));
  if (metadataBuffer.length > MAX_METADATA_LENGTH) {
    throw new Error('Backup metadata is too large');
  }
  const metadataLength = Buffer.alloc(4);
  metadataLength.writeUInt32BE(metadataBuffer.length);
  const header = Buffer.concat([MAGIC, metadataLength, metadataBuffer, iv]);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);

  yield header;
  for await (const chunk of source) {
    const encrypted = cipher.update(chunk);
    if (encrypted.length) yield encrypted;
  }
  const finalChunk = cipher.final();
  if (finalChunk.length) yield finalChunk;
  yield cipher.getAuthTag();
}

function readExactly(handle, length, position) {
  const buffer = Buffer.alloc(length);
  return (async () => {
    let bytesRead = 0;
    while (bytesRead < length) {
      const result = await handle.read(buffer, bytesRead, length - bytesRead, position + bytesRead);
      if (!result.bytesRead) throw new Error('Backup archive is truncated');
      bytesRead += result.bytesRead;
    }
    return buffer;
  })();
}

async function readBackupHeader(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const prefixLength = MAGIC.length + 4;
    const prefix = await readExactly(handle, prefixLength, 0);
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Unrecognized backup archive format');
    }
    const metadataLength = prefix.readUInt32BE(MAGIC.length);
    if (metadataLength > MAX_METADATA_LENGTH) throw new Error('Backup metadata is invalid');
    const metadataStart = prefixLength;
    const metadataBuffer = await readExactly(handle, metadataLength, metadataStart);
    const metadata = JSON.parse(metadataBuffer.toString('utf8'));
    if (typeof metadata.database !== 'string' || !metadata.database) {
      throw new Error('Backup archive does not identify its source database');
    }
    const ivStart = metadataStart + metadataLength;
    const iv = await readExactly(handle, IV_LENGTH, ivStart);
    const header = Buffer.concat([prefix, metadataBuffer, iv]);
    const stats = await handle.stat();
    const ciphertextStart = ivStart + IV_LENGTH;
    if (stats.size < ciphertextStart + TAG_LENGTH) throw new Error('Backup archive is truncated');
    const authTag = await readExactly(handle, TAG_LENGTH, stats.size - TAG_LENGTH);
    return { metadata, iv, authTag, header, ciphertextStart, size: stats.size };
  } finally {
    await handle.close();
  }
}

async function decryptBackupTo(filePath, destination, key) {
  const header = await readBackupHeader(filePath);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.iv);
  decipher.setAAD(header.header);
  decipher.setAuthTag(header.authTag);
  await pipeline(
    createReadStream(filePath, {
      start: header.ciphertextStart,
      end: header.size - TAG_LENGTH - 1,
    }),
    decipher,
    destination
  );
  return header.metadata;
}

function encryptedBackupStream(source, key, metadata) {
  return Readable.from(encryptedBackupChunks(source, key, metadata));
}

module.exports = {
  decryptBackupTo,
  encryptedBackupStream,
  localMongoDatabase,
  localMongoUriForDatabase,
  parseEncryptionKey,
  readBackupHeader,
};
