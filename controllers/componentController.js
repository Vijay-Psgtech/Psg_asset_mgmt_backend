const Component = require('../models/Component');
const Asset = require('../models/Asset');
const { scopeInstitution } = require('../utils/institutionScope');
const { ForbiddenError, NotFoundError } = require('../utils/errors');

exports.list = async (req, res, next) => {
  try {
    const { search, status, category, page = 1, limit = 20 } = req.query;
    const query = scopeInstitution(req, {});

    if (category && category !== 'all') query.category = category;
    if (status && status !== 'all') query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { manufacturer: { $regex: search, $options: 'i' } },
        { modelNumber: { $regex: search, $options: 'i' } },
        { serialNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    const [data, total] = await Promise.all([
      Component.find(query)
        .populate('institution', 'name code')
        .populate('asset', 'name assetTag')
        .sort({ name: 1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Component.countDocuments(query),
    ]);

    res.json({ data, pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) } });
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    const tenantScope = scopeInstitution(req, {});
    const institution = tenantScope.institution || req.body.institutionId || req.body.institution;
    if (!institution) throw new ForbiddenError('Select an institution before creating components');
    const referenceScope = { ...tenantScope, institution };
    if (req.body.asset && !(await Asset.findOne({ _id: req.body.asset, ...referenceScope }).select('_id'))) {
      throw new NotFoundError('Asset not found');
    }

    const payload = {
      institution,
      name: req.body.name,
      category: req.body.category || 'Other',
      manufacturer: req.body.manufacturer || '',
      modelNumber: req.body.modelNumber || '',
      serialNumber: req.body.serialNumber || '',
      quantity: Number(req.body.quantity ?? 1),
      status: req.body.status || 'available',
      asset: req.body.asset || null,
      notes: req.body.notes || '',
      createdBy: req.user._id,
    };
    res.status(201).json(await Component.create(payload));
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try {
    const tenantScope = scopeInstitution(req, {});
    const editable = ['name', 'category', 'manufacturer', 'modelNumber', 'serialNumber', 'quantity', 'status', 'asset', 'notes'];
    const updates = Object.fromEntries(editable.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]]));
    if (updates.asset && !(await Asset.findOne({ _id: updates.asset, ...tenantScope }).select('_id'))) {
      throw new NotFoundError('Asset not found');
    }
    const item = await Component.findOneAndUpdate(
      { _id: req.params.id, ...tenantScope },
      updates,
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ message: 'Component not found' });
    res.json(item);
  } catch (error) { next(error); }
};

exports.remove = async (req, res, next) => {
  try {
    const item = await Component.findOneAndDelete({ _id: req.params.id, ...scopeInstitution(req, {}) });
    if (!item) return res.status(404).json({ message: 'Component not found' });
    res.status(204).send();
  } catch (error) { next(error); }
};
