const QRCode = require('qrcode');
const Asset = require('../models/Asset');
const { nextAssetTag } = require('../utils/assetTag');
const { CATEGORIES, STATUSES } = require('../models/Asset');

exports.importAssets = async (req, res, next) => {
  try {
    const records = Array.isArray(req.body) ? req.body : req.body.assets;
    if (!Array.isArray(records) || !records.length) return res.status(400).json({ message: 'assets must be a non-empty array' });
    if (records.length > 500) return res.status(400).json({ message: 'Import is limited to 500 assets per request' });
    const assets = [];
    for (const record of records) {
      if (!record?.name || !CATEGORIES.includes(record.category)) return res.status(400).json({ message: 'Each asset requires a name and valid category' });
      if (record.status && !STATUSES.includes(record.status)) return res.status(400).json({ message: `Invalid asset status: ${record.status}` });
      const assetTag = record.assetTag || await nextAssetTag();
      const asset = new Asset({ ...record, assetTag, createdBy: req.user._id });
      asset.qrCode = await QRCode.toDataURL(JSON.stringify({ assetTag, id: asset._id.toString() }), { margin: 1, width: 300 });
      await asset.save();
      assets.push(asset);
    }
    res.status(201).json({ imported: assets.length, assets });
  } catch (error) { next(error); }
};
