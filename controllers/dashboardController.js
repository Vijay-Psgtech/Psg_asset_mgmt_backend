const Asset = require('../models/Asset'); // ASSUMPTION: has `status` field e.g. Available/Assigned/In Repair/Archived
const Assignment = require('../models/Assignment');
const Accessory = require('../models/Accessory');
const Consumable = require('../models/Consumable');
const License = require('../models/License');
const User = require('../models/User');

// These two are optional — comment out the relevant block below if you don't have them yet.
let Maintenance;
try {
  Maintenance = require('../models/Maintenance');
} catch (e) {
  Maintenance = null;
}

let AuditLog;
try {
  AuditLog = require('../models/AuditLog');
} catch (e) {
  AuditLog = null;
}

// GET /api/dashboard/summary
exports.getSummary = async (req, res, next) => {
  try {
    const [totalAssets, statusAgg, activeAssignments, overdueAssignments, totalLicenses, totalAccessories, totalConsumables, totalPeople, categoryAgg] = await Promise.all([
      Asset.countDocuments(),
      Asset.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Assignment.countDocuments({ status: 'assigned' }),
      Assignment.countDocuments({ status: { $ne: 'returned' }, dueDate: { $lt: new Date() } }),
      License.countDocuments(),
      Accessory.countDocuments(),
      Consumable.countDocuments(),
      User.countDocuments({ active: true }),
      Asset.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    ]);

    const byStatus = statusAgg.reduce((acc, s) => {
      acc[s._id || 'Unspecified'] = s.count;
      return acc;
    }, {});

    let maintenanceDue = null;
    if (Maintenance) {
      // ASSUMPTION: Maintenance docs have a `status` field with an 'Open'/'Scheduled' value
      maintenanceDue = await Maintenance.countDocuments({ status: { $in: ['Open', 'Scheduled'] } });
    }

    res.json({
      totalAssets,
      byStatus, // e.g. { Available: 12, Assigned: 30, "In Repair": 2, Archived: 5 }
      activeAssignments,
      overdueAssignments,
      maintenanceDue,
      totals: { licenses: totalLicenses, accessories: totalAccessories, consumables: totalConsumables, people: totalPeople },
      byCategory: categoryAgg.reduce((acc, item) => { acc[item._id || 'Other'] = item.count; return acc; }, {}),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/activity?limit=10
exports.getRecentActivity = async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;

    if (!AuditLog) {
      return res.json({ data: [], note: 'AuditLog model not found — wire this up to your real audit log.' });
    }

    // ASSUMPTION: AuditLog has { action, targetType, targetLabel, performedBy: {name}, createdAt }
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(Number(limit));
    res.json({ data: logs });
  } catch (err) {
    next(err);
  }
};