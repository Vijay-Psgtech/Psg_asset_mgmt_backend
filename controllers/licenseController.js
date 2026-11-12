const License = require('../models/License');
const Asset = require('../models/Asset');
const { scopeInstitution } = require('../utils/institutionScope');
const { ForbiddenError } = require('../utils/errors');
const { paginateDerivedStatus } = require('../utils/paginateDerivedStatus');

// GET /api/licenses?status=Active&search=adobe&page=1&limit=20
exports.getLicenses = async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const query = scopeInstitution(req, {});

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { vendor: { $regex: search, $options: 'i' } },
      ];
    }

    const now = new Date();
    const result = await paginateDerivedStatus({
      model: License,
      filter: query,
      status,
      page,
      limit,
      populate: [
        { path: 'institution', select: 'name code' },
        { path: 'seatAssignments.asset', select: 'name assetTag' },
      ],
      computationStages: [
        {
          $addFields: {
            _computedStatus: {
              $switch: {
                branches: [
                  {
                    case: {
                      $and: [
                        { $ne: [{ $ifNull: ['$expirationDate', null] }, null] },
                        { $lt: ['$expirationDate', now] },
                      ],
                    },
                    then: 'Expired',
                  },
                  {
                    case: {
                      $and: [
                        { $ne: [{ $ifNull: ['$expirationDate', null] }, null] },
                        {
                          $lte: [
                            { $divide: [{ $subtract: ['$expirationDate', now] }, 86400000] },
                            30,
                          ],
                        },
                      ],
                    },
                    then: 'Expiring Soon',
                  },
                ],
                default: 'Active',
              },
            },
          },
        },
      ],
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// GET /api/licenses/:id
exports.getLicense = async (req, res, next) => {
  try {
    const license = await License.findOne({ _id: req.params.id, ...scopeInstitution(req, {}) }).populate('seatAssignments.asset', 'name assetTag');
    if (!license) return res.status(404).json({ message: 'License not found' });
    res.json(license);
  } catch (err) {
    next(err);
  }
};

// POST /api/licenses
exports.createLicense = async (req, res, next) => {
  try {
    const { name, licenseKey, vendor, category, seats, purchaseDate, expirationDate, cost, notes } = req.body;
    if (!name || !seats) {
      return res.status(400).json({ message: 'name and seats are required' });
    }

    const tenantScope = scopeInstitution(req, {});
    const institution = tenantScope.institution || req.body.institution;
    if (!institution) throw new ForbiddenError('Select an institution before creating licenses');

    const license = await License.create({
      institution,
      name,
      licenseKey,
      vendor,
      category,
      seats,
      purchaseDate: purchaseDate || undefined,
      expirationDate: expirationDate || undefined,
      cost,
      notes,
    });

    res.status(201).json(license);
  } catch (err) {
    next(err);
  }
};

// PATCH /api/licenses/:id
exports.updateLicense = async (req, res, next) => {
  try {
    const editable = ['name', 'licenseKey', 'vendor', 'category', 'seats', 'purchaseDate', 'expirationDate', 'cost', 'notes'];
    const updates = {};
    editable.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    const license = await License.findOneAndUpdate(
      { _id: req.params.id, ...scopeInstitution(req, {}) },
      updates,
      { new: true, runValidators: true }
    );
    if (!license) return res.status(404).json({ message: 'License not found' });
    res.json(license);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/licenses/:id
exports.deleteLicense = async (req, res, next) => {
  try {
    const license = await License.findOneAndDelete({ _id: req.params.id, ...scopeInstitution(req, {}) });
    if (!license) return res.status(404).json({ message: 'License not found' });
    res.json({ message: 'License deleted' });
  } catch (err) {
    next(err);
  }
};

// POST /api/licenses/:id/checkout
// body: { name, email, assetId, notes }
exports.checkoutSeat = async (req, res, next) => {
  try {
    const { name, email, assetId, notes } = req.body;
    if (!name) return res.status(400).json({ message: 'assignedTo.name is required' });

    const license = await License.findOne({ _id: req.params.id, ...scopeInstitution(req, {}) });
    if (!license) return res.status(404).json({ message: 'License not found' });
    if (assetId) {
      const asset = await Asset.findOne({ _id: assetId, ...scopeInstitution(req, {}) }).select('_id');
      if (!asset) return res.status(404).json({ message: 'Asset not found' });
    }

    if (license.seatAssignments.length >= license.seats) {
      return res.status(409).json({ message: 'No seats available on this license' });
    }

    license.seatAssignments.push({
      assignedTo: { name, email },
      asset: assetId || undefined,
      assignedBy: req.user?._id,
      notes,
    });
    await license.save();

    res.status(201).json(license);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/licenses/:id/seats/:seatId  (check the seat back in / revoke it)
exports.checkinSeat = async (req, res, next) => {
  try {
    const license = await License.findOne({ _id: req.params.id, ...scopeInstitution(req, {}) });
    if (!license) return res.status(404).json({ message: 'License not found' });

    const seat = license.seatAssignments.id(req.params.seatId);
    if (!seat) return res.status(404).json({ message: 'Seat assignment not found' });

    seat.deleteOne();
    await license.save();

    res.json(license);
  } catch (err) {
    next(err);
  }
};