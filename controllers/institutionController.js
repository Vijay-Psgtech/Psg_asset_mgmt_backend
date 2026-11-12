const Institution = require('../models/Institution');
const asyncHandler = require('../utils/asyncHandler');
const { ValidationError, NotFoundError } = require('../utils/errors');

const list = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.status) query.status = req.query.status;
  if (req.query.search) {
    query.$or = [
      { name: { $regex: req.query.search, $options: 'i' } },
      { code: { $regex: req.query.search, $options: 'i' } },
    ];
  }

  const institutions = await Institution.find(query).sort({ createdAt: -1 });
  res.json({ institutions: institutions.map((institution) => institution.toSafeJSON()), total: institutions.length });
});

const create = asyncHandler(async (req, res) => {
  const { name, code, status, logo, contactEmail, contactPhone, address, settings } = req.body;

  if (!name || !name.trim()) throw new ValidationError('Institution name is required');
  if (!code || !code.trim()) throw new ValidationError('Institution code is required');

  const normalizedCode = code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (normalizedCode.length < 2) throw new ValidationError('Institution code must be at least 2 characters');

  const existing = await Institution.findOne({ code: normalizedCode });
  if (existing) throw new ValidationError('An institution with this code already exists');

  const institution = await Institution.create({
    name: name.trim(),
    code: normalizedCode,
    status: status || 'active',
    logo: logo || '',
    contactEmail: contactEmail || '',
    contactPhone: contactPhone || '',
    address: address || '',
    settings: {
      currency: settings?.currency || 'INR',
      timezone: settings?.timezone || 'Asia/Kolkata',
    },
    createdBy: req.user?._id,
  });

  res.status(201).json({ institution: institution.toSafeJSON() });
});

const update = asyncHandler(async (req, res) => {
  const institution = await Institution.findById(req.params.id);
  if (!institution) throw new NotFoundError('Institution not found');

  const { name, code, status, logo, contactEmail, contactPhone, address, settings } = req.body;
  if (name !== undefined) institution.name = name.trim();
  if (code !== undefined) {
    const normalizedCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!normalizedCode) throw new ValidationError('Institution code is required');
    institution.code = normalizedCode;
  }
  if (status !== undefined) institution.status = status;
  if (logo !== undefined) institution.logo = logo || '';
  if (contactEmail !== undefined) institution.contactEmail = contactEmail || '';
  if (contactPhone !== undefined) institution.contactPhone = contactPhone || '';
  if (address !== undefined) institution.address = address || '';
  if (settings !== undefined) {
    institution.settings = {
      ...institution.settings.toObject?.(),
      ...settings,
    };
  }

  await institution.save();
  res.json({ institution: institution.toSafeJSON() });
});

module.exports = { list, create, update };
