const mongoose = require('mongoose');

/**
 * ASSUMPTIONS:
 * - Seats are tracked as an embedded array rather than a separate collection, since a seat
 *   is just "this license, assigned to this person/asset" — no independent lifecycle of its own.
 *   If you'd rather have a first-class LicenseSeat collection (e.g. for reporting), split
 *   `seatAssignments` out the same way Assignment.js is split from Asset.
 * - Auth middleware attaches req.user with at least { _id, name }
 */

const seatAssignmentSchema = new mongoose.Schema(
  {
    assignedTo: {
      name: { type: String, required: true, trim: true },
      email: { type: String, trim: true, lowercase: true },
    },
    asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset' }, // optional: seat tied to a device
    assignedDate: { type: Date, default: Date.now },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true },
  },
  { _id: true, timestamps: true }
);

const licenseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // e.g. "Adobe Creative Cloud"
    licenseKey: { type: String, trim: true },
    vendor: { type: String, trim: true },
    category: { type: String, trim: true }, // e.g. "Design", "Productivity", "Security"
    seats: { type: Number, required: true, min: 1, default: 1 },
    purchaseDate: { type: Date },
    expirationDate: { type: Date },
    cost: { type: Number, min: 0 },
    notes: { type: String, trim: true },
    seatAssignments: [seatAssignmentSchema],
  },
  { timestamps: true }
);

licenseSchema.virtual('seatsUsed').get(function () {
  return this.seatAssignments?.length || 0;
});

licenseSchema.virtual('seatsAvailable').get(function () {
  return this.seats - (this.seatAssignments?.length || 0);
});

licenseSchema.methods.computeStatus = function () {
  if (this.expirationDate && new Date() > this.expirationDate) return 'Expired';
  if (this.expirationDate) {
    const daysLeft = (this.expirationDate - new Date()) / (1000 * 60 * 60 * 24);
    if (daysLeft <= 30) return 'Expiring Soon';
  }
  return 'Active';
};

licenseSchema.set('toObject', { virtuals: true });
licenseSchema.set('toJSON', { virtuals: true });

licenseSchema.index({ name: 'text', vendor: 'text' });

module.exports = mongoose.model('License', licenseSchema);