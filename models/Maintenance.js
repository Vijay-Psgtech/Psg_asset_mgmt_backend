const mongoose = require('mongoose');

const TYPES = ['Repair', 'Scheduled Service', 'Inspection', 'Upgrade', 'Other'];
const STATUSES = ['Open', 'Scheduled', 'In Progress', 'Completed', 'Cancelled'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

const maintenanceSchema = new mongoose.Schema(
  {
    asset: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Asset',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: TYPES,
      default: 'Repair',
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    vendor: { type: String, trim: true },
    cost: { type: Number, min: 0 },
    priority: {
      type: String,
      enum: PRIORITIES,
      default: 'Medium',
      index: true,
    },
    assignee: { type: String, trim: true },
    team: { type: String, trim: true },
    recurring: { type: Boolean, default: false },
    startDate: { type: Date, default: Date.now, required: true },
    dueDate: { type: Date },
    completedDate: { type: Date },
    status: {
      type: String,
      enum: STATUSES,
      default: 'Open',
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

maintenanceSchema.methods.computeStatus = function () {
  if (['Completed', 'Cancelled'].includes(this.status)) return this.status;
  if (this.dueDate && new Date() > this.dueDate) return 'Overdue';
  return this.status;
};

maintenanceSchema.index({ title: 'text', vendor: 'text', assignee: 'text', team: 'text' });

module.exports = mongoose.model('Maintenance', maintenanceSchema);
module.exports.TYPES = TYPES;
module.exports.STATUSES = STATUSES;
module.exports.PRIORITIES = PRIORITIES;