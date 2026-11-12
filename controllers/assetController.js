const QRCode = require('qrcode');
const Asset = require('../models/Asset');
const Assignment = require('../models/Assignment');
const Maintenance = require('../models/Maintenance');
const { nextAssetTag } = require('../utils/assetTag');
const { recordAudit } = require('../utils/audit');
const { NotFoundError, ConflictError, ForbiddenError } = require('../utils/errors');
const { scopeInstitution } = require('../utils/institutionScope');
const asyncHandler = require('../utils/asyncHandler');

const normalizeInstitutionId = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const id = value._id || value.id || value.toString();
    return id ? String(id) : null;
  }
  return String(value);
};

const getTenantFilter = (req, extraFilter = {}) => scopeInstitution(req, extraFilter);

const ensureTenantAccess = async (req, asset) => {
  if (!asset) return;
  if (req.user?.role === 'superadmin') return;

  const tenantId = normalizeInstitutionId(req.user?.institution?._id || req.user?.institution);
  const assetInstitutionId = normalizeInstitutionId(asset.institution);

  if (!tenantId || !assetInstitutionId || tenantId !== assetInstitutionId) {
    throw new ForbiddenError('This institution cannot access that asset');
  }
};

// GET /api/assets?search=&category=&status=&page=&limit=&sort=
const list = asyncHandler(async (req, res) => {
  const { search, category, status, page = 1, limit = 20, sort = '-createdAt' } = req.query;

  const filter = getTenantFilter(req);
  if (category) filter.category = category;
  if (status) filter.status = status;
  if (search) filter.$text = { $search: search };

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const [items, total] = await Promise.all([
    Asset.find(filter)
      .sort(sort)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate({ path: 'institution', select: 'name code' })
      .populate({ path: 'currentAssignment', select: 'assignedTo checkoutDate dueDate status' }),
    Asset.countDocuments(filter),
  ]);

  res.json({
    items,
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

const getById = asyncHandler(async (req, res) => {
  const asset = await Asset.findById(req.params.id).populate('currentAssignment');
  if (!asset) throw new NotFoundError('Asset not found');
  await ensureTenantAccess(req, asset);

  const [assignmentHistory, maintenanceHistory] = await Promise.all([
    Assignment.find({ asset: asset._id, institution: asset.institution }).sort('-checkoutDate'),
    Maintenance.find({ asset: asset._id, institution: asset.institution }).sort('-createdAt'),
  ]);

  res.json({ asset, assignmentHistory, maintenanceHistory });
});

const sanitizeAssetForScan = (asset) => {
  if (!asset) return null;

  return {
    _id: asset._id,
    assetTag: asset.assetTag,
    name: asset.name,
    category: asset.category,
    status: asset.status,
    location: asset.location,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    currentAssignment: asset.currentAssignment
      ? {
          _id: asset.currentAssignment._id,
          status: asset.currentAssignment.status,
          dueDate: asset.currentAssignment.dueDate,
          checkoutDate: asset.currentAssignment.checkoutDate,
          assignedTo: asset.currentAssignment.assignedTo
            ? {
                name: asset.currentAssignment.assignedTo.name,
                department: asset.currentAssignment.assignedTo.department || null,
              }
            : null,
        }
      : null,
  };
};

// Lookup by human-readable tag - used by the QR scan flow
const getByTag = asyncHandler(async (req, res) => {
  const rawTag = String(req.params.tag || '').trim();
  const filter = getTenantFilter(req, { assetTag: rawTag });
  const asset = await Asset.findOne(filter)
    .populate({
      path: 'currentAssignment',
      select: 'assignedTo status dueDate checkoutDate',
    });

  if (!asset) throw new NotFoundError('No asset found for that tag');

  res.json({ asset: sanitizeAssetForScan(asset) });
});

const create = asyncHandler(async (req, res) => {
  const institutionId = req.user?.role === 'superadmin'
    ? normalizeInstitutionId(req.user.institution) || req.body.institutionId || req.body.institution || req.query.institutionId
    : normalizeInstitutionId(req.user?.institution);
  if (!institutionId) {
    throw new ForbiddenError('Select an institution before creating assets');
  }

  const assetTag = await nextAssetTag({ institutionId });

  const asset = new Asset({
    ...req.body,
    institution: institutionId,  
    assetTag,
    createdBy: req.user._id,
  });
  asset.qrCode = await QRCode.toDataURL(JSON.stringify({ assetTag, id: asset._id.toString() }), { margin: 1, width: 300 });

  await asset.save();
  await recordAudit({ req, action: 'create', entityType: 'Asset', entityId: asset._id, entityLabel: asset.assetTag, changes: { after: asset.toObject() } });

  res.status(201).json({ asset });
});

const update = asyncHandler(async (req, res) => {
  const asset = await Asset.findById(req.params.id);
  if (!asset) throw new NotFoundError('Asset not found');
  await ensureTenantAccess(req, asset);

  const before = asset.toObject();
  Object.assign(asset, req.body);
  if (req.user?.institution && asset.institution?.toString() !== (req.user.institution._id || req.user.institution).toString()) {
    asset.institution = req.user.institution._id || req.user.institution;
  }
  await asset.save();

  await recordAudit({
    req,
    action: 'update',
    entityType: 'Asset',
    entityId: asset._id,
    entityLabel: asset.assetTag,
    changes: { before, after: asset.toObject() },
  });

  res.json({ asset });
});

const remove = asyncHandler(async (req, res) => {
  const asset = await Asset.findById(req.params.id);
  if (!asset) throw new NotFoundError('Asset not found');
  await ensureTenantAccess(req, asset);
  if (asset.status === 'assigned') {
    throw new ConflictError('Cannot delete an asset that is currently assigned - return it first');
  }

  await asset.deleteOne();
  await Assignment.deleteMany({ asset: asset._id, institution: asset.institution });
  await Maintenance.deleteMany({ asset: asset._id, institution: asset.institution });

  await recordAudit({ req, action: 'delete', entityType: 'Asset', entityId: asset._id, entityLabel: asset.assetTag, changes: { before: asset.toObject() } });

  res.status(204).send();
});

const regenerateQr = asyncHandler(async (req, res) => {
  const asset = await Asset.findById(req.params.id);
  if (!asset) throw new NotFoundError('Asset not found');
  await ensureTenantAccess(req, asset);

  asset.qrCode = await QRCode.toDataURL(JSON.stringify({ assetTag: asset.assetTag, id: asset._id.toString() }), { margin: 1, width: 300 });
  await asset.save();

  res.json({ qrCode: asset.qrCode });
});

module.exports = { list, getById, getByTag, create, update, remove, regenerateQr };
