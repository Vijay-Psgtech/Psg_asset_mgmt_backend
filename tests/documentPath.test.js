const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { UPLOAD_ROOT } = require('../middleware/upload');
const { _resolveStoredFilePath } = require('../controllers/documentController');
const { NotFoundError } = require('../utils/errors');

test('stored document paths reject traversal and missing files', async () => {
  await assert.rejects(
    _resolveStoredFilePath(path.join(UPLOAD_ROOT, '..', 'outside.pdf')),
    (error) => error instanceof NotFoundError
  );

  const testDirectory = path.join(UPLOAD_ROOT, `path-test-${crypto.randomUUID()}`);
  const fixture = path.join(testDirectory, 'fixture.pdf');
  try {
    await fs.mkdir(testDirectory, { recursive: true });
    await fs.writeFile(fixture, 'document fixture');
    assert.equal(await _resolveStoredFilePath(fixture), await fs.realpath(fixture));
    await assert.rejects(
      _resolveStoredFilePath(path.join(testDirectory, 'missing.pdf')),
      (error) => error instanceof NotFoundError
    );
  } finally {
    await fs.rm(testDirectory, { recursive: true, force: true });
  }
});
