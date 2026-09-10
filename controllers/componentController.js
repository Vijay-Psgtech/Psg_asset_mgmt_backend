const Component = require('../models/Component');

exports.list = async (req, res, next) => {
  try {
    const { search, status, category, page = 1, limit = 20 } = req.query;
    const query = {};

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
    const payload = {
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
  try { const item = await Component.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }); if (!item) return res.status(404).json({ message: 'Component not found' }); res.json(item); } catch (error) { next(error); }
};

exports.remove = async (req, res, next) => {
  try { const item = await Component.findByIdAndDelete(req.params.id); if (!item) return res.status(404).json({ message: 'Component not found' }); res.status(204).send(); } catch (error) { next(error); }
};
