const AuditLog = require('../models/AuditLog');

/**
 * Records an audit trail entry. Never throws - a logging failure should
 * not break the primary request, but we do surface it to the console.
 */
async function recordAudit({ req, action, entityType, entityId, entityLabel, changes }) {
  try {
    await AuditLog.create({
      action,
      entityType,
      entityId,
      entityLabel,
      changes,
      performedBy: req.user
        ? { id: req.user._id, name: req.user.name, email: req.user.email }
        : undefined,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  } catch (err) {
    console.error('[audit] failed to record entry:', err.message);
  }
}

module.exports = { recordAudit };
