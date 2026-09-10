const mongoose = require('mongoose');

/**
 * Consumables (toner, cables cut to length, cleaning supplies) are issued and never returned —
 * unlike Accessory, there's no checkinDate here. Stock only ever goes down until restocked.
 */

const consumableIssueSchema = new mongoose.Schema(
  {
    assignedTo: {
      name: { type: String, required: true, trim: true },
      email: { type: String, trim: true, lowercase: true },
      department: { type: String, trim: true },
    },
    quantity: { type: Number, required: true, min: 1 },
    issuedDate: { type: Date, default: Date.now },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true },
  },
  { _id: true, timestamps: true }
);

const consumableSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // e.g. "HP 26A Toner"
    category: { type: String, trim: true },
    manufacturer: { type: String, trim: true },
    modelNumber: { type: String, trim: true },
    totalQty: { type: Number, required: true, min: 0, default: 0 }, // stock ever received
    minQty: { type: Number, min: 0, default: 0 },
    purchaseDate: { type: Date },
    cost: { type: Number, min: 0 }, // unit cost
    notes: { type: String, trim: true },
    issues: [consumableIssueSchema],
  },
  { timestamps: true }
);

consumableSchema.virtual('qtyIssued').get(function () {
  return (this.issues || []).reduce((sum, i) => sum + i.quantity, 0);
});

consumableSchema.virtual('qtyRemaining').get(function () {
  return this.totalQty - this.qtyIssued;
});

consumableSchema.methods.computeStatus = function () {
  const remaining = this.totalQty - this.qtyIssued;
  if (remaining <= 0) return 'Out of Stock';
  if (this.minQty && remaining <= this.minQty) return 'Low Stock';
  return 'In Stock';
};

consumableSchema.set('toObject', { virtuals: true });
consumableSchema.set('toJSON', { virtuals: true });
consumableSchema.index({ name: 'text', manufacturer: 'text' });

module.exports = mongoose.model('Consumable', consumableSchema);