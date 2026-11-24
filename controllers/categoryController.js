const Category = require('../models/Category');
const Asset = require('../models/Asset');
const CustomField = require('../models/CustomField');
const asyncHandler = require('../utils/asyncHandler');
const { ConflictError, NotFoundError, ValidationError } = require('../utils/errors');
const { DEFAULT_CATEGORY_NAMES } = require('../models/Category');

const toCode = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const ensureDefaultCategories = async () => {
  const count = await Category.countDocuments();
  if (count) return;
  await Category.insertMany(DEFAULT_CATEGORY_NAMES.map((name, sortOrder) => ({
    name,
    code: toCode(name),
    active: true,
    sortOrder,
  })), { ordered: false });
};

const mergeExistingAssetCategories = async () => {
  const names = await Asset.distinct('category');
  for (const name of names.filter(Boolean)) {
    await Category.updateOne(
      { name: { $regex: `^${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
      { $setOnInsert: { name: String(name).trim(), code: toCode(name), active: true } },
      { upsert: true }
    );
  }
};

const list = asyncHandler(async (req, res) => {
  await ensureDefaultCategories();
  await mergeExistingAssetCategories();
  const filter = req.query.includeInactive === 'true' ? {} : { active: true };
  const categories = await Category.find(filter).sort({ sortOrder: 1, name: 1 });
  res.json({ categories, total: categories.length });
});

const create = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new ValidationError('Category name is required');
  const code = toCode(req.body.code || name);
  if (!code) throw new ValidationError('Category code is required');

  if (await Category.exists({ name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } })) {
    throw new ConflictError('A category with this name already exists');
  }
  if (await Category.exists({ code })) throw new ConflictError('A category with this code already exists');

  const category = await Category.create({
    name,
    code,
    description: String(req.body.description || '').trim(),
    active: req.body.active !== false,
    sortOrder: Number.isFinite(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : 0,
  });
  res.status(201).json({ category });
});

const update = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new NotFoundError('Category not found');

  const oldName = category.name;
  const name = req.body.name === undefined ? oldName : String(req.body.name).trim();
  if (!name) throw new ValidationError('Category name is required');
  const code = toCode(req.body.code === undefined ? category.code : req.body.code);
  if (!code) throw new ValidationError('Category code is required');

  if (await Category.exists({ _id: { $ne: category._id }, name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } })) {
    throw new ConflictError('A category with this name already exists');
  }
  if (await Category.exists({ _id: { $ne: category._id }, code })) throw new ConflictError('A category with this code already exists');

  if (oldName !== name) {
    await Asset.updateMany({ category: oldName }, { $set: { category: name } });
    const customFields = await CustomField.find({ categories: oldName });
    await Promise.all(customFields.map((field) => {
      field.categories = field.categories.map((item) => item === oldName ? name : item);
      return field.save();
    }));
  }

  category.name = name;
  category.code = code;
  if (req.body.description !== undefined) category.description = String(req.body.description).trim();
  if (req.body.active !== undefined) category.active = Boolean(req.body.active);
  if (req.body.sortOrder !== undefined) category.sortOrder = Number(req.body.sortOrder) || 0;
  await category.save();
  res.json({ category });
});

const remove = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new NotFoundError('Category not found');
  const [assetCount, fieldCount] = await Promise.all([
    Asset.countDocuments({ category: category.name }),
    CustomField.countDocuments({ categories: category.name }),
  ]);
  if (assetCount || fieldCount) {
    throw new ConflictError(`Cannot delete "${category.name}" because it is used by ${assetCount} asset(s) and ${fieldCount} custom field(s). Deactivate it instead.`);
  }
  await category.deleteOne();
  res.status(204).send();
});

module.exports = { list, create, update, remove };
