const AssetRequest = require('../models/AssetRequest');
const Asset = require('../models/Asset');
const { scopeInstitution } = require('../utils/institutionScope');

exports.listMine = async (req, res, next) => {
  try {
    const requests = await AssetRequest.find({ ...scopeInstitution(req, {}), requester: req.user._id })
      .populate('asset', 'name assetTag category model location status')
      .sort({ createdAt: -1 });
    res.json({ data: requests });
  } catch (error) {
    next(error);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { assetId, note } = req.body;
    const tenantScope = scopeInstitution(req, {});
    const asset = await Asset.findOne({ _id: assetId, ...tenantScope });
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    if (asset.status !== 'available') return res.status(409).json({ message: 'This asset is not currently requestable' });

    const existing = await AssetRequest.findOne({ institution: asset.institution, asset: asset._id, requester: req.user._id, status: 'pending' });
    if (existing) return res.status(409).json({ message: 'You already requested this asset' });

    const request = await AssetRequest.create({ institution: asset.institution, asset: asset._id, requester: req.user._id, note });
    res.status(201).json(await request.populate('asset', 'name assetTag category model location status'));
  } catch (error) {
    next(error);
  }
};
