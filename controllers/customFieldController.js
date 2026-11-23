const CustomField = require('../models/CustomField');
const { NotFoundError, ConflictError } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const filter = { active: true };
  if (req.query.category) filter.categories = req.query.category;
  const fields = await CustomField.find(filter).sort({ label: 1 });
  res.json({ fields });
});

const create = asyncHandler(async (req, res) => {
  if (await CustomField.exists({ key: req.body.key })) {
    throw new ConflictError('A custom field with this key already exists');
  }
  const field = await CustomField.create(req.body);
  res.status(201).json({ field });
});

const update = asyncHandler(async (req, res) => {
  const field = await CustomField.findById(req.params.id);
  if (!field) throw new NotFoundError('Custom field not found');
  if (req.body.key !== field.key && await CustomField.exists({ key: req.body.key, _id: { $ne: field._id } })) {
    throw new ConflictError('A custom field with this key already exists');
  }
  for (const key of ['label', 'key', 'type', 'options', 'categories', 'required']) field[key] = req.body[key];
  await field.save();
  res.json({ field });
});

const remove = asyncHandler(async (req, res) => {
  const field = await CustomField.findByIdAndDelete(req.params.id);
  if (!field) throw new NotFoundError('Custom field not found');
  res.status(204).send();
});

module.exports = { list, create, update, remove };
