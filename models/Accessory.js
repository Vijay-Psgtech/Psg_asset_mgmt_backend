const mongoose = require('mongoose');

/**
 * Accessories are non-serialized items issued by quantity (keyboards, mice, cables, dongles)
 * rather than tracked as individual serialized assets. A single accessory doc holds total
 * stock; `checkouts` records who currently has how many, and can be checked back in.
 */

const accessoryCheckoutSchema = new mongoose.Schema(
  {
    assignedTo: {
      name: { type: String, required: true, trim: true },
      email: { type: String, trim: true, lowercase: true },
      department: { type: String, trim: true },
    },
    quantity: { type: Number, required: true, min: 1 },
    checkoutDate: { type: Date, default: Date.now },
    checkinDate: { type: Date }, // null while still checked out
    checkedOutBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true },
  },
  { _id: true, timestamps: true }
);

const accessorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // e.g. "USB-C Dock"
    category: { type: String, trim: true },
    manufacturer: { type: String, trim: true },
    modelNumber: { type: String, trim: true },
    totalQty: { type: Number, required: true, min: 0, default: 0 },
    minQty: { type: Number, min: 0, default: 0 }, // reorder threshold
    purchaseDate: { type: Date },
    cost: { type: Number, min: 0 }, // unit cost
    notes: { type: String, trim: true },
    checkouts: [accessoryCheckoutSchema],
  },
  { timestamps: true }
);

accessorySchema.virtual('qtyCheckedOut').get(function () {
  return (this.checkouts || [])
    .filter((c) => !c.checkinDate)
    .reduce((sum, c) => sum + c.quantity, 0);
});

accessorySchema.virtual('qtyAvailable').get(function () {
  return this.totalQty - this.qtyCheckedOut;
});

accessorySchema.methods.computeStatus = function () {
  const available = this.totalQty - this.qtyCheckedOut;
  if (available <= 0) return 'Out of Stock';
  if (this.minQty && available <= this.minQty) return 'Low Stock';
  return 'In Stock';
};

accessorySchema.set('toObject', { virtuals: true });
accessorySchema.set('toJSON', { virtuals: true });
accessorySchema.index({ name: 'text', manufacturer: 'text' });

module.exports = mongoose.model('Accessory', accessorySchema);