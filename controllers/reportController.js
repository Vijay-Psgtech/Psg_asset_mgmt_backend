const Asset = require('../models/Asset');
const Assignment = require('../models/Assignment');
const Maintenance = require('../models/Maintenance');
const AuditLog = require('../models/AuditLog');
const asyncHandler = require('../utils/asyncHandler');

const csvEscape = (value) => {
  const raw = value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  const normalized = /^[\s\u0000-\u001f\uFEFF]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${normalized.replace(/"/g, '""')}"`;
};

exports.overview = asyncHandler(async (req, res) => {
  const assetScope = require('../utils/institutionScope').scopeInstitution(req, {});
  const assignmentScope = require('../utils/institutionScope').scopeInstitution(req, {});
  const maintenanceScope = require('../utils/institutionScope').scopeInstitution(req, {});
  const logScope = require('../utils/institutionScope').scopeInstitution(req, {});
   
  const [assets, assignments, maintenance, logs] = await Promise.all([
    Asset.find(assetScope).select('assetTag name category status location createdAt').lean(),
    Assignment.find(assignmentScope).populate('asset', 'assetTag name').lean(),
    Maintenance.find(maintenanceScope).populate('asset', 'assetTag name').lean(),
    AuditLog.find(logScope).sort({ createdAt: -1 }).limit(5000).lean(),
  ]);
  res.json({
    generatedAt: new Date().toISOString(),
    totals: { assets: assets.length, assignments: assignments.length, maintenance: maintenance.length, logs: logs.length },
    assets,
    assignments,
    maintenance,
    logs,
  });
});

exports.download = asyncHandler(async (req, res) => {
  const type = ['assets', 'assignments', 'maintenance', 'logs'].includes(req.query.type) ? req.query.type : 'assets';
  const data = await exports._getRows(type, req);
  const headers = data.length ? Object.keys(data[0]) : ['message'];
  const rows = data.length ? data : [{ message: 'No records found' }];
  const csv = [headers.map(csvEscape).join(','), ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="assetrak-${type}-report-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

exports._getRows = async (type, req) => {
  const institutionScope = require('../utils/institutionScope').scopeInstitution(req, {});
  if (type === 'assets') return Asset.find(institutionScope).select('assetTag name category status location createdAt').lean();
  if (type === 'assignments') return Assignment.find(institutionScope).populate('asset', 'assetTag name').lean();
  if (type === 'maintenance') return Maintenance.find(institutionScope).populate('asset', 'assetTag name').lean();
  return AuditLog.find(institutionScope).sort({ createdAt: -1 }).limit(5000).lean();
};

exports._csvEscape = csvEscape;
