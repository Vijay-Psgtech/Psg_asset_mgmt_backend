const mongoose = require('mongoose');

const componentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, trim: true, default: 'Other' },
  manufacturer: { type: String, trim: true },
  modelNumber: { type: String, trim: true },
  serialNumber: { type: String, trim: true, index: true },
  quantity: { type: Number, min: 0, default: 1 },
  status: { type: String, enum: ['available', 'assigned', 'in_maintenance', 'retired'], default: 'available', index: true },
  asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', default: null },
  notes: { type: String, trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

componentSchema.index({ name: 'text', category: 'text', manufacturer: 'text', modelNumber: 'text', serialNumber: 'text' });
module.exports = mongoose.model('Component', componentSchema);
