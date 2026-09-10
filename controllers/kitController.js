const Kit = require('../models/Kit');

exports.list = async (req, res, next) => {
  try {
    const { search, active, category, page = 1, limit = 20 } = req.query;
    const query = {};

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
    const payload = {
      name: req.body.name,
      category: req.body.category || 'Other',
      description: req.body.description || '',
      active: req.body.active !== undefined ? Boolean(req.body.active) : true,
      items: Array.isArray(req.body.items) ? req.body.items.map((item) => ({
        name: item.name,
        quantity: Number(item.quantity || 1),
        component: item.component || null,
        asset: item.asset || null,
      })) : [],
      createdBy: req.user._id,
    };
    res.status(201).json(await Kit.create(payload));
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try { const item = await Kit.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }); if (!item) return res.status(404).json({ message: 'Kit not found' }); res.json(item); } catch (error) { next(error); }
};

exports.remove = async (req, res, next) => {
  try { const item = await Kit.findByIdAndDelete(req.params.id); if (!item) return res.status(404).json({ message: 'Kit not found' }); res.status(204).send(); } catch (error) { next(error); }
};
