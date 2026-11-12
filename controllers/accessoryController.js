const Accessory = require('../models/Accessory');
const { scopeInstitution } = require('../utils/institutionScope');
const { ForbiddenError } = require('../utils/errors');
const { paginateDerivedStatus } = require('../utils/paginateDerivedStatus');

// GET /api/accessories?status=Low Stock&search=dock&page=1&limit=20
exports.getAccessories = async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const query = scopeInstitution(req, {});

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { manufacturer: { $regex: search, $options: 'i' } },
      ];
    }

    const activeCheckouts = {
      $filter: {
        input: { $ifNull: ['$checkouts', []] },
        as: 'checkout',
        cond: { $eq: [{ $ifNull: ['$$checkout.checkinDate', null] }, null] },
      },
    };
    const result = await paginateDerivedStatus({
      model: Accessory,
      filter: query,
      status,
      page,
      limit,
      populate: [{ path: 'institution', select: 'name code' }],
      computationStages: [
        {
          $addFields: {
            _computedCheckedOut: {
              $sum: {
                $map: { input: activeCheckouts, as: 'checkout', in: '$$checkout.quantity' },
              },
            },
          },
        },
        {
          $addFields: {
            _computedAvailable: { $subtract: [{ $ifNull: ['$totalQty', 0] }, '$_computedCheckedOut'] },
          },
        },
        {
          $addFields: {
            _computedStatus: {
              $switch: {
                branches: [
                  { case: { $lte: ['$_computedAvailable', 0] }, then: 'Out of Stock' },
                  {
                    case: {
                      $and: [
                        { $gt: [{ $ifNull: ['$minQty', 0] }, 0] },
                        { $lte: ['$_computedAvailable', { $ifNull: ['$minQty', 0] }] },
                      ],
                    },
                    then: 'Low Stock',
                  },
                ],
                default: 'In Stock',
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

// GET /api/accessories/:id
exports.getAccessory = async (req, res, next) => {
  try {
    const accessory = await Accessory.findOne({ _id: req.params.id, ...scopeInstitution(req, {}) });
    if (!accessory) return res.status(404).json({ message: 'Accessory not found' });
    res.json(accessory);
  } catch (err) {
    next(err);


  }
};

// POST /api/accessories
exports.createAccessory = async (req, res, next) => {
  try {
    const { name, category, manufacturer, modelNumber, totalQty, minQty, purchaseDate, cost, notes } = req.body;
    if (!name) return res.status(400).json({ message: 'name is required' });

    const tenantScope = scopeInstitution(req, {});
    const institution = tenantScope.institution || req.body.institution;
    if (!institution) throw new ForbiddenError('Select an institution before creating accessories');

    const accessory = await Accessory.create({
      institution,
      name,
      category,
      manufacturer,
      modelNumber,
      totalQty: totalQty ?? 0,
      minQty: minQty ?? 0,
      purchaseDate: purchaseDate || undefined,
      cost,
      notes,
    });

    res.status(201).json(accessory);
  } catch (err) {
    next(err);
  }
};

// PATCH /api/accessories/:id
exports.updateAccessory = async (req, res, next) => {
  try {
    const editable = ['name', 'category', 'manufacturer', 'modelNumber', 'totalQty', 'minQty', 'purchaseDate', 'cost', 'notes'];
    const updates = {};
    editable.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    const accessory = await Accessory.findOneAndUpdate(
      { _id: req.params.id, ...scopeInstitution(req, {}) },
      updates,
      { new: true, runValidators: true }
    );
    if (!accessory) return res.status(404).json({ message: 'Accessory not found' });
    res.json(accessory);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/accessories/:id
exports.deleteAccessory = async (req, res, next) => {
  try {
    const accessory = await Accessory.findOneAndDelete({ _id: req.params.id, ...scopeInstitution(req, {}) });
    if (!accessory) return res.status(404).json({ message: 'Accessory not found' });
    res.json({ message: 'Accessory deleted' });
  } catch (err) {
    next(err);
  }
};

// POST /api/accessories/:id/checkout
// body: { name, email, department, quantity, notes }
exports.checkoutAccessory = async (req, res, next) => {
  try {
    const { name, email, department, quantity, notes } = req.body;
    const activeCheckouts = {
      $filter: {
        input: { $ifNull: ['$checkouts', []] },
        as: 'checkout',
        cond: { $eq: [{ $ifNull: ['$$checkout.checkinDate', null] }, null] },
      },
    };
    const checkedOutQuantity = {
      $sum: {
        $map: {
          input: activeCheckouts,
          as: 'checkout',
          in: { $ifNull: ['$$checkout.quantity', 0] },
        },
      },
    };
    const accessory = await Accessory.findOneAndUpdate(
      {
        _id: req.params.id,
        ...scopeInstitution(req, {}),
        $expr: {
          $gte: [
            { $subtract: [{ $ifNull: ['$totalQty', 0] }, checkedOutQuantity] },
            quantity,
          ],
        },
      },
      {
        $push: {
          checkouts: {
            assignedTo: { name, email, department },
            quantity,
            checkedOutBy: req.user?._id,
            notes,
          },
        },
      },
      { new: true, runValidators: true }
    );

    if (!accessory) {
      const exists = await Accessory.exists({ _id: req.params.id, ...scopeInstitution(req, {}) });
      if (!exists) return res.status(404).json({ message: 'Accessory not found' });
      return res.status(409).json({ message: 'Not enough stock available for that quantity' });
    }
    res.status(201).json(accessory);
  } catch (err) {
    next(err);
  }
};

// PATCH /api/accessories/:id/checkouts/:checkoutId/checkin
exports.checkinAccessory = async (req, res, next) => {
  try {
    const now = new Date();
    const accessory = await Accessory.findOneAndUpdate(
      {
        _id: req.params.id,
        ...scopeInstitution(req, {}),
        checkouts: {
          $elemMatch: {
            _id: req.params.checkoutId,
            $or: [{ checkinDate: { $exists: false } }, { checkinDate: null }],
          },
        },
      },
      {
        $set: {
          updatedAt: now,
          'checkouts.$.checkinDate': now,
          'checkouts.$.checkedInBy': req.user?._id,
          'checkouts.$.updatedAt': now,
        },
      },
      { new: true, runValidators: true }
    );
    if (!accessory) {
      const existing = await Accessory.findOne({ _id: req.params.id, ...scopeInstitution(req, {}) })
        .select('checkouts');
      if (!existing) return res.status(404).json({ message: 'Accessory not found' });
      const checkout = existing.checkouts.id(req.params.checkoutId);
      if (!checkout) return res.status(404).json({ message: 'Checkout record not found' });
      return res.status(409).json({ message: 'This checkout has already been returned' });
    }
    res.json(accessory);
  } catch (err) {
    next(err);
  }
};