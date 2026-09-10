const mongoose = require('mongoose');

/**
 * ASSUMPTIONS — adjust to match your real schema:
 * - You have an Asset model at '../models/Asset' with at least: name, assetTag, status, assignedTo
 * - Auth middleware attaches req.user with at least { _id, name }
 * - "Assigned To" is a person who may or may not be a system user (e.g. staff/employee),
 *   so it's stored as an embedded snapshot rather than a hard ref. If you already have an
 *   Employee/User collection you want to ref instead, swap `assignedTo` for a ref + populate.
 */

const assignmentSchema = new mongoose.Schema(
  {
    asset: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Asset',
      required: true,
      index: true,
    },
    assignedTo: {
      name: { type: String, required: true, trim: true },
      email: { type: String, trim: true, lowercase: true },
      department: { type: String, trim: true },
    },
    checkedOutBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    checkedInBy: {
      type: mongoose.Schema.Types.ObjectId,    
      ref: 'User',
    },
    checkoutDate: { type: Date, default: Date.now, required: true },
    dueDate: { type: Date },
    checkinDate: { type: Date },
    conditionOut: { type: String, trim: true }, // e.g. "Good", "Minor scratches"
    conditionIn: { type: String, trim: true },
    notes: { type: String, trim: true },
    status: {
      type: String,
      enum: ['assigned', 'returned', 'overdue'],
      default: 'assigned',
      index: true,
    },
  },
  { timestamps: true }
);

// Keep status honest: flip to overdue automatically when read past dueDate.
assignmentSchema.methods.computeStatus = function () {
  if (this.status === 'returned') return 'returned';
  if (this.dueDate && !this.checkinDate && new Date() > this.dueDate) return 'overdue';
  return 'assigned';
};

assignmentSchema.index({ 'assignedTo.name': 'text', 'assignedTo.email': 'text' });

module.exports = mongoose.model('Assignment', assignmentSchema);