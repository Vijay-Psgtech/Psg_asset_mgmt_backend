const { ValidationError } = require('./errors');

const isEmpty = (value) => value === undefined || value === null || value === '';

function normalizeCustomFieldValues(fields, values = {}) {
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  const unknownKeys = Object.keys(values).filter((key) => !fieldByKey.has(key));
  if (unknownKeys.length) {
    throw new ValidationError(`Unknown custom field${unknownKeys.length > 1 ? 's' : ''}: ${unknownKeys.join(', ')}`);
  }

  const normalized = [];
  for (const field of fields) {
    const value = values[field.key];
    if (isEmpty(value)) {
      if (field.required) throw new ValidationError(`${field.label} is required`);
      continue;
    }

    let valid = true;
    if (field.type === 'text' || field.type === 'textarea') valid = typeof value === 'string' && value.length <= 2000;
    if (field.type === 'number') valid = typeof value === 'number' && Number.isFinite(value);
    if (field.type === 'date') valid = typeof value === 'string' && !Number.isNaN(Date.parse(value));
    if (field.type === 'checkbox') valid = typeof value === 'boolean';
    if (field.type === 'select') valid = typeof value === 'string' && field.options.includes(value);
    if (!valid) throw new ValidationError(`Invalid value for ${field.label}`);
    if (field.required && field.type === 'checkbox' && value !== true) {
      throw new ValidationError(`${field.label} must be selected`);
    }

    normalized.push({ key: field.key, label: field.label, value });
  }

  return normalized;
}

module.exports = { normalizeCustomFieldValues };
