const Consumable = require('../models/Consumable');
const { scopeInstitution } = require('../utils/institutionScope');
const { ForbiddenError } = require('../utils/errors');
const { paginateDerivedStatus } = require('../utils/paginateDerivedStatus');

// GET /api/consumables?status=Low Stock&search=toner&page=1&limit=20
exports.getConsumables = async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const query = scopeInstitution(req, {});

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { manufacturer: { $regex: search, $options: 'i' } },
      ];
    }

    const result = await paginateDerivedStatus({
      model: Consumable,
      filter: query,
      status,
      page,
      limit,
      populate: [{ path: 'institution', select: 'name code' }],
      computationStages: [
        {
          $addFields: {
            _computedIssued: {
              $sum: {
                $map: {
                  input: { $ifNull: ['$issues', []] },
                  as: 'issue',
                  in: '$$issue.quantity',
                },
              },
            },
          },
        },
        {
          $addFields: {
            _computedAvailable: { $subtract: [{ $ifNull: ['$totalQty', 0] }, '$_computedIssued'] },
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

// GET /api/consumables/:id
exports.getConsumable = async (req, res, next) => {
  try {
    const consumable = await Consumable.findOne({ _id: req.params.id, ...scopeInstitution(req, {}) });
    if (!consumable) return res.status(404).json({ message: 'Consumable not found' });
    res.json(consumable);
  } catch (err) {
    next(err);
  }
};

// POST /api/consumables
exports.createConsumable = async (req, res, next) => {
  try {
    const { name, category, manufacturer, modelNumber, totalQty, minQty, purchaseDate, cost, notes } = req.body;
    if (!name) return res.status(400).json({ message: 'name is required' });

    const tenantScope = scopeInstitution(req, {});
    const institution = tenantScope.institution || req.body.institution;
    if (!institution) throw new ForbiddenError('Select an institution before creating consumables');

    const consumable = await Consumable.create({
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

    res.status(201).json(consumable);
  } catch (err) {
    next(err);
  }
};

// PATCH /api/consumables/:id
// Also used to restock — pass a higher totalQty.
exports.updateConsumable = async (req, res, next) => {
  try {
    const editable = ['name', 'category', 'manufacturer', 'modelNumber', 'totalQty', 'minQty', 'purchaseDate', 'cost', 'notes'];
    const updates = {};
    editable.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    const consumable = await Consumable.findOneAndUpdate(
      { _id: req.params.id, ...scopeInstitution(req, {}) },
      updates,
      { new: true, runValidators: true }
    );
    if (!consumable) return res.status(404).json({ message: 'Consumable not found' });
    res.json(consumable);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/consumables/:id
exports.deleteConsumable = async (req, res, next) => {
  try {
    const consumable = await Consumable.findOneAndDelete({ _id: req.params.id, ...scopeInstitution(req, {}) });
    if (!consumable) return res.status(404).json({ message: 'Consumable not found' });
    res.json({ message: 'Consumable deleted' });
  } catch (err) {
    next(err);
  }
};

// POST /api/consumables/:id/issue
// body: { name, email, department, quantity, notes }
exports.issueConsumable = async (req, res, next) => {
  try {
    const { name, email, department, quantity, notes } = req.body;
    const qty = Number(quantity) || 1;

    if (!name) return res.status(400).json({ message: 'assignedTo.name is required' });

    const consumable = await Consumable.findOne({ _id: req.params.id, ...scopeInstitution(req, {}) });
    if (!consumable) return res.status(404).json({ message: 'Consumable not found' });

    const issued = consumable.issues.reduce((sum, i) => sum + i.quantity, 0);
    if (qty > consumable.totalQty - issued) {
      return res.status(409).json({ message: 'Not enough stock available for that quantity' });
    }

    consumable.issues.push({
      assignedTo: { name, email, department },
      quantity: qty,
      issuedBy: req.user?._id,
      notes,
    });
    await consumable.save();

    res.status(201).json(consumable);
  } catch (err) {
    next(err);
  }
};