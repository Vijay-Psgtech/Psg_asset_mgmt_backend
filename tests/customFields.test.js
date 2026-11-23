const test = require('node:test');
const assert = require('node:assert/strict');
const { createCustomFieldSchema, updateCustomFieldSchema, createAssetSchema } = require('../utils/schemas');
const { normalizeCustomFieldValues } = require('../utils/customFieldValues');
const { ValidationError } = require('../utils/errors');
const { buildGlobalCustomFieldPlan } = require('../scripts/migrateCustomFieldsGlobal');

test('custom field definitions require options for dropdowns and categories', () => {
  const field = {
    label: 'Memory size',
    key: 'memory_size',
    type: 'select',
    options: ['8 GB', '16 GB'],
    categories: ['Laptop'],
  };
  assert.equal(createCustomFieldSchema.parse(field).required, false);
  assert.throws(() => createCustomFieldSchema.parse({ ...field, options: [] }));
  assert.throws(() => createCustomFieldSchema.parse({ ...field, categories: [] }));
  assert.equal(updateCustomFieldSchema.parse({ ...field, label: 'Updated label' }).label, 'Updated label');
  assert.throws(() => updateCustomFieldSchema.parse({ ...field, options: [] }));
  assert.equal(Object.hasOwn(createCustomFieldSchema.parse({ ...field, institutionId: '507f1f77bcf86cd799439011' }), 'institutionId'), false);
});

test('global migration merges matching definitions and refuses conflicting keys', () => {
  const definitions = [
    { _id: 'first', key: 'memory_size', label: 'Memory size', type: 'select', options: ['8 GB', '16 GB'], required: false, categories: ['Laptop'], institution: 'one' },
    { _id: 'second', key: 'memory_size', label: 'Memory size', type: 'select', options: ['8 GB', '16 GB'], required: false, categories: ['Desktop'], institution: 'two' },
  ];
  const [merged] = buildGlobalCustomFieldPlan(definitions);
  assert.equal(merged.canonical._id, 'first');
  assert.deepEqual(merged.categories, ['Laptop', 'Desktop']);
  assert.equal(merged.duplicates.length, 1);
  assert.throws(() => buildGlobalCustomFieldPlan([
    ...definitions,
    { ...definitions[1], _id: 'third', label: 'RAM' },
  ]), /Conflicting definitions for custom field keys: memory_size/);
});

test('asset schema accepts keyed custom field values', () => {
  const payload = { name: 'Laptop', category: 'Laptop', customFields: { memory_size: '16 GB' } };
  assert.deepEqual(createAssetSchema.parse(payload).customFields, payload.customFields);
});

test('custom field values enforce required, type, and select-option constraints', () => {
  const fields = [
    { key: 'memory_size', label: 'Memory size', type: 'select', options: ['8 GB', '16 GB'], required: true },
    { key: 'managed', label: 'Managed', type: 'checkbox', options: [], required: true },
    { key: 'purchase_year', label: 'Purchase year', type: 'number', options: [], required: false },
  ];

  assert.deepEqual(normalizeCustomFieldValues(fields, {
    memory_size: '16 GB',
    managed: true,
    purchase_year: 2025,
  }), [
    { key: 'memory_size', label: 'Memory size', value: '16 GB' },
    { key: 'managed', label: 'Managed', value: true },
    { key: 'purchase_year', label: 'Purchase year', value: 2025 },
  ]);
  assert.throws(() => normalizeCustomFieldValues(fields, { memory_size: '32 GB', managed: true }), ValidationError);
  assert.throws(() => normalizeCustomFieldValues(fields, { memory_size: '16 GB', managed: false }), ValidationError);
  assert.throws(() => normalizeCustomFieldValues(fields, { memory_size: '16 GB', managed: true, extra: 'unexpected' }), ValidationError);
});
