const Eula = require('../models/Eula');

exports.list = async (req, res, next) => {
  try {
    const query = req.user.role === 'asset_user' ? { $or: [{ 'assignedTo.email': req.user.email }, { 'assignedTo.name': req.user.name }] } : {};
    const data = await Eula.find(query).populate('asset', 'name assetTag').populate('license', 'name vendor').sort({ createdAt: -1 });
    res.json({ data });
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try { res.status(201).json(await Eula.create({ ...req.body, createdBy: req.user._id })); } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try { const item = await Eula.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }); if (!item) return res.status(404).json({ message: 'EULA not found' }); res.json(item); } catch (error) { next(error); }
};

exports.remove = async (req, res, next) => {
  try { const item = await Eula.findByIdAndDelete(req.params.id); if (!item) return res.status(404).json({ message: 'EULA not found' }); res.status(204).send(); } catch (error) { next(error); }
};
