const Asset = require('../models/Asset');
const Assignment = require('../models/Assignment');
const License = require('../models/License');
const Maintenance = require('../models/Maintenance');

function parseDate(value, fallback) {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? null : date;
}

exports.getCalendarEvents = async (req, res, next) => {
  try {
    const now = new Date();
    const start = parseDate(req.query.start, new Date(now.getFullYear(), now.getMonth(), 1));
    const end = parseDate(req.query.end, new Date(now.getFullYear(), now.getMonth() + 1, 1));
    if (!start || !end || start >= end) return res.status(400).json({ message: 'Invalid calendar date range' });

    const requestedTypes = String(req.query.types || 'maintenance,assignment,license,warranty')
      .split(',').map((type) => type.trim()).filter(Boolean);
    const search = String(req.query.search || '').trim();
    const eventTypes = new Set(requestedTypes);
    const events = [];

    if (eventTypes.has('maintenance')) {
      const query = {
        $or: [
          { startDate: { $lt: end }, dueDate: { $gte: start } },
          { startDate: { $gte: start, $lt: end }, dueDate: null },
        ],
      };
      const records = await Maintenance.find(query).populate('asset', 'name assetTag category').sort({ startDate: 1 });
      records.forEach((record) => {
        if (search && !`${record.title} ${record.vendor || ''} ${record.asset?.name || ''} ${record.asset?.assetTag || ''}`.toLowerCase().includes(search.toLowerCase())) return;
        const status = record.computeStatus();
        events.push({
          id: `maintenance-${record._id}`,
          type: 'maintenance',
          title: `Maintenance: ${record.title}`,
          start: record.startDate,
          end: record.dueDate || record.startDate,
          allDay: true,
          status,
          colorKey: status === 'Overdue' ? 'overdue' : 'maintenance',
          asset: record.asset ? { id: record.asset._id, name: record.asset.name, assetTag: record.asset.assetTag } : null,
          sourceId: record._id,
          sourcePath: '/maintenance',
        });
      });
    }

    if (eventTypes.has('assignment')) {
      const records = await Assignment.find({ dueDate: { $gte: start, $lt: end }, status: { $ne: 'returned' } })
        .populate('asset', 'name assetTag category').sort({ dueDate: 1 });
      records.forEach((record) => {
        if (search && !`${record.assignedTo?.name || ''} ${record.asset?.name || ''} ${record.asset?.assetTag || ''}`.toLowerCase().includes(search.toLowerCase())) return;
        const status = record.computeStatus();
        events.push({
          id: `assignment-${record._id}`,
          type: 'assignment',
          title: `${status === 'overdue' ? 'Checkin overdue' : 'Expected checkin'}: ${record.asset?.assetTag || 'Asset'}`,
          start: record.dueDate,
          end: record.dueDate,
          allDay: true,
          status,
          colorKey: status === 'overdue' ? 'overdue' : 'assignment',
          asset: record.asset ? { id: record.asset._id, name: record.asset.name, assetTag: record.asset.assetTag } : null,
          sourceId: record._id,
          sourcePath: '/assignments',
        });
      });
    }

    if (eventTypes.has('license')) {
      const records = await License.find({ expirationDate: { $gte: start, $lt: end } }).sort({ expirationDate: 1 });
      records.forEach((record) => {
        if (search && !`${record.name} ${record.vendor || ''}`.toLowerCase().includes(search.toLowerCase())) return;
        const status = record.computeStatus();
        events.push({
          id: `license-${record._id}`,
          type: 'license',
          title: `License expires: ${record.name}`,
          start: record.expirationDate,
          end: record.expirationDate,
          allDay: true,
          status,
          colorKey: status === 'Expired' ? 'overdue' : 'license',
          asset: null,
          sourceId: record._id,
          sourcePath: '/licenses',
        });
      });
    }

    if (eventTypes.has('warranty')) {
      const records = await Asset.find({ warrantyExpiry: { $gte: start, $lt: end } }).select('name assetTag category warrantyExpiry').sort({ warrantyExpiry: 1 });
      records.forEach((record) => {
        if (search && !`${record.name} ${record.assetTag} ${record.category}`.toLowerCase().includes(search.toLowerCase())) return;
        events.push({
          id: `warranty-${record._id}`,
          type: 'warranty',
          title: `Warranty expires: ${record.assetTag}`,
          start: record.warrantyExpiry,
          end: record.warrantyExpiry,
          allDay: true,
          status: record.warrantyExpiry < now ? 'Expired' : 'Active',
          colorKey: 'warranty',
          asset: { id: record._id, name: record.name, assetTag: record.assetTag },
          sourceId: record._id,
          sourcePath: `/assets/${record._id}`,
        });
      });
    }

    events.sort((left, right) => new Date(left.start) - new Date(right.start));
    res.json({ events, range: { start, end } });
  } catch (err) {
    next(err);
  }
};