const AuditLog = require('../models/AuditLog');
const logger = require('./logger');

/**
 * Records an audit trail entry. Never throws - a logging failure should
 * not break the primary request, but we do surface it to the console.
 */
async function recordAudit({ req, action, entityType, entityId, entityLabel, changes }) {
  try {
    const activeInstitution = req.institution || req.user?.institution;
    await AuditLog.create({
      institution: activeInstitution?._id || activeInstitution || undefined,
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
    logger.warn('audit_record_failed', {
      requestId: req.requestId,
      errorName: err.name || 'Error',
      errorCode: err.code,
    });
  }
}

module.exports = { recordAudit };
