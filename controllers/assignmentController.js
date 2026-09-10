const Assignment = require('../models/Assignment');
const Asset = require('../models/Asset'); // ASSUMPTION: path/name of your Asset model
const License = require('../models/License');
const Accessory = require('../models/Accessory');
const Consumable = require('../models/Consumable');
const AssetRequest = require('../models/AssetRequest');
const Eula = require('../models/Eula');
const { findUserByPerson, notifySafely, notifyUser } = require('../utils/notifications');

function escapeRegex(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/assignments/my-dashboard
exports.getMyDashboard = async (req, res, next) => {
  try {
    const name = escapeRegex(req.user.name);
    const email = escapeRegex(req.user.email);
    const personMatch = { $or: [{ 'assignedTo.email': new RegExp(`^${email}$`, 'i') }, { 'assignedTo.name': new RegExp(`^${name}$`, 'i') }] };

    const [assignments, licenses, accessories, consumables, allRequestable, requested, eulas] = await Promise.all([
      Assignment.find(personMatch).populate('asset', 'name assetTag category brand model serialNumber status location warrantyExpiry qrCode').sort({ checkoutDate: -1 }).lean(),
      License.find({ 'seatAssignments.assignedTo': { $exists: true } }).select('name vendor category expirationDate seatAssignments').lean(),
      Accessory.find({ 'checkouts.assignedTo': { $exists: true } }).select('name category manufacturer modelNumber checkouts').lean(),
      Consumable.find({ 'issues.assignedTo': { $exists: true } }).select('name category manufacturer modelNumber issues').lean(),
      Asset.find({ status: 'available' }).select('name assetTag category brand model serialNumber location status').sort({ createdAt: -1 }).limit(50).lean(),
      AssetRequest.find({ requester: req.user._id }).populate('asset', 'name assetTag category model location status').sort({ createdAt: -1 }).lean(),
      Eula.find({ $or: [{ 'assignedTo.email': req.user.email }, { 'assignedTo.name': req.user.name }] }).populate('asset', 'name assetTag').populate('license', 'name vendor').sort({ createdAt: -1 }).lean(),
    ]);

    const matchesPerson = (entry) => {
      const assigned = entry.assignedTo || {};
      return (assigned.email && assigned.email.toLowerCase() === req.user.email.toLowerCase())
        || (assigned.name && assigned.name.toLowerCase() === req.user.name.toLowerCase());
    };
    const myLicenses = licenses.flatMap((license) => license.seatAssignments.filter(matchesPerson).map((seat) => ({ ...license, seatAssignments: undefined, assignedDate: seat.assignedDate, notes: seat.notes })));
    const myAccessories = accessories.flatMap((accessory) => accessory.checkouts.filter((checkout) => !checkout.checkinDate && matchesPerson(checkout)).map((checkout) => ({ ...accessory, checkouts: undefined, quantity: checkout.quantity, checkoutDate: checkout.checkoutDate, notes: checkout.notes })));
    const myConsumables = consumables.flatMap((consumable) => consumable.issues.filter(matchesPerson).map((issue) => ({ ...consumable, issues: undefined, quantity: issue.quantity, issuedDate: issue.issuedDate, notes: issue.notes })));

    const normalizedAssignments = assignments.map((assignment) => ({
      ...assignment,
      status: assignment.status === 'returned' ? 'returned' : (assignment.dueDate && new Date(assignment.dueDate) < new Date() ? 'overdue' : 'assigned'),
    }));

    res.json({
      user: req.user.toSafeJSON(),
      assets: normalizedAssignments,
      licenses: myLicenses,
      accessories: myAccessories,
      consumables: myConsumables,
      eulas,
      requestable: allRequestable.filter((asset) => !requested.some((request) => request.asset?._id?.toString() === asset._id.toString() && request.status === 'pending')),
      requested,
      summary: {
        assets: normalizedAssignments.filter((item) => item.status !== 'returned').length,
        licenses: myLicenses.length,
        accessories: myAccessories.reduce((total, item) => total + item.quantity, 0),
        consumables: myConsumables.reduce((total, item) => total + item.quantity, 0),
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/assignments?status=assigned&search=john&page=1&limit=20
exports.getAssignments = async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const query = {};

    if (status && status !== 'all') {
      if (status === 'overdue') {
        query.status = { $ne: 'returned' };
        query.dueDate = { $lt: new Date() };
      } else {
        query.status = status;
      }
    }

    if (search) {
      query.$or = [
        { 'assignedTo.name': { $regex: search, $options: 'i' } },
        { 'assignedTo.email': { $regex: search, $options: 'i' } },
        { 'assignedTo.department': { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      Assignment.find(query)
        .populate('asset', 'name assetTag category status')
        .populate('checkedOutBy', 'name')
        .populate('checkedInBy', 'name')
        .sort({ checkoutDate: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Assignment.countDocuments(query),
    ]);

    // Normalize computed "overdue" status for display without mutating stale docs.
    const data = items.map((doc) => {
      const obj = doc.toObject();
      obj.status = doc.computeStatus();
      return obj;
    });

    res.json({
      data,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/assignments/:id
exports.getAssignment = async (req, res, next) => {
  try {
    const assignment = await Assignment.findById(req.params.id)
      .populate('asset')
      .populate('checkedOutBy', 'name')
      .populate('checkedInBy', 'name');

    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
    res.json(assignment);
  } catch (err) {
    next(err);
  }
};

// POST /api/assignments/checkout
// body: { assetId, assignedTo: { name, email, department }, dueDate, conditionOut, notes }
exports.checkoutAsset = async (req, res, next) => {
  try {
    const { assetId, assignedTo, dueDate, conditionOut, notes } = req.body;

    if (!assetId || !assignedTo?.name) {
      return res.status(400).json({ message: 'assetId and assignedTo.name are required' });
    }

    const asset = await Asset.findById(assetId);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });

    if (asset.status && asset.status !== 'available') {
      return res.status(409).json({ message: `Asset is currently "${asset.status}" and cannot be checked out` });
    }

    const assignment = await Assignment.create({
      asset: assetId,
      assignedTo,
      checkedOutBy: req.user?._id,
      dueDate: dueDate || undefined,
      conditionOut,
      notes,
      status: 'assigned',
    });

    // Reflect the checkout on the asset itself.
    asset.status = 'assigned';
    asset.currentAssignment = assignment._id;
    await asset.save();

    const populated = await assignment.populate('asset', 'name assetTag category status');
    const assignedUser = await findUserByPerson(assignedTo);
    await notifySafely(() => notifyUser({
      user: assignedUser,
      type: 'assignment',
      title: 'Asset assigned to you',
      message: `${populated.asset?.assetTag || 'An asset'} (${populated.asset?.name || 'asset'}) was assigned to you${dueDate ? ` and is due back on ${new Date(dueDate).toLocaleDateString()}.` : '.'}`,
      entityType: 'Assignment',
      entityId: assignment._id,
    }));
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

// PATCH /api/assignments/:id/checkin
// body: { conditionIn, notes }
exports.checkinAsset = async (req, res, next) => {
  try {
    const { conditionIn, notes } = req.body;

    const assignment = await Assignment.findById(req.params.id).populate('asset');
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
    if (assignment.status === 'returned') {
      return res.status(409).json({ message: 'This assignment has already been checked in' });
    }

    assignment.status = 'returned';
    assignment.checkinDate = new Date();
    assignment.checkedInBy = req.user?._id;
    if (conditionIn) assignment.conditionIn = conditionIn;
    if (notes) assignment.notes = notes;
    await assignment.save();

    if (assignment.asset) {
      assignment.asset.status = 'available';
      assignment.asset.currentAssignment = null;
      await assignment.asset.save();
    }

    const assignedUser = await findUserByPerson(assignment.assignedTo);
    await notifySafely(() => notifyUser({
      user: assignedUser,
      type: 'assignment',
      title: 'Asset checked in',
      message: `${assignment.asset?.assetTag || 'An assigned asset'} has been checked in by ${req.user.name}.`,
      entityType: 'Assignment',
      entityId: assignment._id,
    }));
    res.json(assignment);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/assignments/:id  (correcting a mis-logged entry, not a normal check-in)
exports.deleteAssignment = async (req, res, next) => {
  try {
    const assignment = await Assignment.findByIdAndDelete(req.params.id);
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
    res.json({ message: 'Assignment deleted' });
  } catch (err) {
    next(err);
  }
};