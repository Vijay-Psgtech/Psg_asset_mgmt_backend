const mongoose = require('mongoose');

const TYPES = ['repair', 'routine', 'upgrade', 'inspection'];
const STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];

const maintenanceSchema = new mongoose.Schema(
  {
    asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true, index: true },
    type: { type: String, enum: TYPES, required: true },
    description: { type: String, required: true, trim: true },
    cost: { type: Number, min: 0, default: 0 },
    vendor: { type: String, trim: true },
    scheduledDate: { type: Date },
    completedDate: { type: Date },
    status: { type: String, enum: STATUSES, default: 'scheduled', index: true },
    performedBy: { type: String, trim: true },
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MaintenanceRecord', maintenanceSchema);
module.exports.TYPES = TYPES;
module.exports.STATUSES = STATUSES;
