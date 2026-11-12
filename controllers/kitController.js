const Kit = require('../models/Kit');
const Component = require('../models/Component');
const Asset = require('../models/Asset');
const { scopeInstitution } = require('../utils/institutionScope');
const { ForbiddenError, NotFoundError } = require('../utils/errors');

async function validateKitReferences(items, tenantScope) {
  const componentIds = [...new Set(items.map((item) => item.component).filter(Boolean).map(String))];
  const assetIds = [...new Set(items.map((item) => item.asset).filter(Boolean).map(String))];
  const [components, assets] = await Promise.all([
    componentIds.length ? Component.find({ _id: { $in: componentIds }, ...tenantScope }).select('_id') : [],
    assetIds.length ? Asset.find({ _id: { $in: assetIds }, ...tenantScope }).select('_id') : [],
  ]);
  if (components.length !== componentIds.length || assets.length !== assetIds.length) {
    throw new NotFoundError('A referenced component or asset was not found');
  }
}

exports.list = async (req, res, next) => {
  try {
    const { search, active, category, page = 1, limit = 20 } = req.query;
    const query = scopeInstitution(req, {});

    if (category && category !== 'all') query.category = category;
    if (active !== undefined && active !== 'all') query.active = active === 'true';
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    const [data, total] = await Promise.all([
      Kit.find(query)
        .populate('institution', 'name code')
        .populate('items.component', 'name modelNumber')
        .populate('items.asset', 'name assetTag')
        .sort({ name: 1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Kit.countDocuments(query),
    ]);

    res.json({ data, pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) } });
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    const tenantScope = scopeInstitution(req, {});
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const institution = tenantScope.institution || req.body.institutionId || req.body.institution;
    if (!institution) throw new ForbiddenError('Select an institution before creating kits');
    await validateKitReferences(items, { ...tenantScope, institution });

    const payload = {
      institution,
      name: req.body.name,
      category: req.body.category || 'Other',
      description: req.body.description || '',
      active: req.body.active !== undefined ? Boolean(req.body.active) : true,
      items: items.map((item) => ({
        name: item.name,
        quantity: Number(item.quantity || 1),
        component: item.component || null,
        asset: item.asset || null,
      })),
      createdBy: req.user._id,
    };
    res.status(201).json(await Kit.create(payload));
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try {
    const tenantScope = scopeInstitution(req, {});
    const editable = ['name', 'category', 'description', 'active', 'items'];
    const updates = Object.fromEntries(editable.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]]));
    if (updates.items) await validateKitReferences(updates.items, tenantScope);
    const item = await Kit.findOneAndUpdate(
      { _id: req.params.id, ...tenantScope },
      updates,
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ message: 'Kit not found' });
    res.json(item);
  } catch (error) { next(error); }
};

exports.remove = async (req, res, next) => {
  try {
    const item = await Kit.findOneAndDelete({ _id: req.params.id, ...scopeInstitution(req, {}) });
    if (!item) return res.status(404).json({ message: 'Kit not found' });
    res.status(204).send();
  } catch (error) { next(error); }
};
