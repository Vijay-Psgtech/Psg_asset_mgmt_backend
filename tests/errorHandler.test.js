const test = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler } = require('../middleware/errorHandler');

test('internal errors are correlated and diagnosed in server logs without exposing details to clients', () => {
  const originalError = console.error;
  const originalNodeEnv = process.env.NODE_ENV;
  let logEntry;
  console.error = (entry) => { logEntry = JSON.parse(entry); };
  process.env.NODE_ENV = 'production';
  const response = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };

  try {
    errorHandler(
      Object.assign(new Error('database connection dropped'), {
        diagnosticContext: { operation: 'asset_import', stage: 'save_asset', recordNumber: 3 },
      }),
      { requestId: 'request-123', method: 'POST', path: '/api/import/assets' },
      response,
      () => {}
    );
  } finally {
    console.error = originalError;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.message, 'Something went wrong');
  assert.equal(response.body.requestId, undefined);
  assert.equal(logEntry.event, 'http_request_failed');
  assert.equal(logEntry.requestId, 'request-123');
  assert.equal(logEntry.errorMessage, 'database connection dropped');
  assert.deepEqual(logEntry.diagnosticContext, {
    operation: 'asset_import',
    stage: 'save_asset',
    recordNumber: 3,
  });
  assert.equal(logEntry.stack, undefined);
});
