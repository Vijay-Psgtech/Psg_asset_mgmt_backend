const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: [
        'create',
        'update',
        'delete',
        'assign',
        'return',
        'maintenance_add',
        'maintenance_update',
        'login',
        'login_failed',
        'logout',
        'document_upload',
        'document_delete',
      ],
      index: true,
    },
    entityType: { type: String, required: true, index: true }, // 'Asset' | 'Assignment' | 'MaintenanceRecord' | 'Auth'
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },
    entityLabel: { type: String }, // human readable, e.g. asset tag
    performedBy: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      name: { type: String },
      email: { type: String },
    },
    changes: { type: mongoose.Schema.Types.Mixed }, // { before, after } snapshot or diff
    ipAddress: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);