const test = require('node:test');
const assert = require('node:assert/strict');

const validate = require('../middleware/validate');
const { assetIdParamSchema, assetListQuerySchema } = require('../utils/schemas');
const { ValidationError } = require('../utils/errors');

test('validate supports params and query sources without breaking body validation', () => {
  const paramsReq = { params: { id: '507f1f77bcf86cd799439011' }, query: {}, body: {} };
  const paramsRes = {};

  validate(assetIdParamSchema, 'params')(paramsReq, paramsRes, (err) => {
    assert.equal(err, undefined);
    assert.equal(paramsReq.params.id, '507f1f77bcf86cd799439011');
  });

  const queryReq = {
    params: {},
    query: { search: 'laptop', page: '2', limit: '25', status: 'available', category: 'Laptop' },
    body: {},
  };

  validate(assetListQuerySchema, 'query')(queryReq, paramsRes, (err) => {
    assert.equal(err, undefined);
    assert.equal(queryReq.query.page, 2);
    assert.equal(queryReq.query.limit, 25);
    assert.equal(queryReq.query.status, 'available');
    assert.equal(queryReq.query.category, 'Laptop');
  });

  const invalidReq = { params: { id: 'bad' }, query: {}, body: {} };
  let invalidErr;
  validate(assetIdParamSchema, 'params')(invalidReq, paramsRes, (err) => {
    invalidErr = err;
  });

  assert.ok(invalidErr instanceof ValidationError);
  assert.equal(invalidErr.status, 400);
  assert.equal(invalidErr.details[0].path, 'id');
});
