const mongoose = require('mongoose');
const Asset = require('../models/Asset'); // ASSUMPTION: has `status` field e.g. Available/Assigned/In Repair/Archived
const Assignment = require('../models/Assignment');
const Accessory = require('../models/Accessory');
const Consumable = require('../models/Consumable');
const License = require('../models/License');
const User = require('../models/User');
const { scopeInstitution } = require('../utils/institutionScope');

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
    const assetScope = scopeInstitution(req, {});
    const assetAggregationScope = { ...assetScope };
    if (assetAggregationScope.institution) {
      assetAggregationScope.institution = new mongoose.Types.ObjectId(assetAggregationScope.institution);
    }
    const assignmentScope = scopeInstitution(req, {});
    const institutionScope = scopeInstitution(req, {});

    const [totalAssets, statusAgg, activeAssignments, overdueAssignments, totalLicenses, totalAccessories, totalConsumables, totalPeople, categoryAgg] = await Promise.all([
      Asset.countDocuments(assetScope),
      Asset.aggregate([{ $match: assetAggregationScope }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Assignment.countDocuments({ ...assignmentScope, status: 'assigned' }),
      Assignment.countDocuments({ ...assignmentScope, status: { $ne: 'returned' }, dueDate: { $lt: new Date() } }),
      License.countDocuments(institutionScope),
      Accessory.countDocuments(institutionScope),
      Consumable.countDocuments(institutionScope),
      User.countDocuments({ ...institutionScope, active: true }),
      Asset.aggregate([{ $match: assetAggregationScope }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    ]);

    const byStatus = statusAgg.reduce((acc, s) => {
      acc[s._id || 'Unspecified'] = s.count;
      return acc;
    }, {});

    let maintenanceDue = null;
    if (Maintenance) {
      // ASSUMPTION: Maintenance docs have a `status` field with an 'Open'/'Scheduled' value
      maintenanceDue = await Maintenance.countDocuments({
        ...institutionScope,
        status: { $in: ['Open', 'Scheduled'] },
      });
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

    const query = scopeInstitution(req, {});
    const logs = await AuditLog.find(query).sort({ createdAt: -1 }).limit(Number(limit));
    res.json({ data: logs });
  } catch (err) {
    next(err);
  }
};