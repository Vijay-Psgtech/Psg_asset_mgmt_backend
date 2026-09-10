const License = require('../models/License');

// GET /api/licenses?status=Active&search=adobe&page=1&limit=20
exports.getLicenses = async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { vendor: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    const items = await License.find(query)
      .populate('seatAssignments.asset', 'name assetTag')
      .sort({ name: 1 });

    let data = items.map((doc) => {
      const obj = doc.toObject({ virtuals: true });
      obj.status = doc.computeStatus();
      return obj;
    });

    // Status filter applied post-compute since it's derived, not stored.
    if (status && status !== 'all') {
      data = data.filter((l) => l.status === status);
    }

    const total = data.length;
    const pagedData = data.slice((pageNum - 1) * limitNum, pageNum * limitNum);
    res.json({ data: pagedData, pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) } });
  } catch (err) {
    next(err);
  }
};

// GET /api/licenses/:id
exports.getLicense = async (req, res, next) => {
  try {
    const license = await License.findById(req.params.id).populate('seatAssignments.asset', 'name assetTag');
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

    const license = await License.create({
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

    const license = await License.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!license) return res.status(404).json({ message: 'License not found' });
    res.json(license);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/licenses/:id
exports.deleteLicense = async (req, res, next) => {
  try {
    const license = await License.findByIdAndDelete(req.params.id);
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

    const license = await License.findById(req.params.id);
    if (!license) return res.status(404).json({ message: 'License not found' });

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
    const license = await License.findById(req.params.id);
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