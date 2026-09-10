const mongoose = require('mongoose');

const kitSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, trim: true, default: 'Other' },
  description: { type: String, trim: true },
  active: { type: Boolean, default: true, index: true },
  items: [{ name: { type: String, required: true, trim: true }, quantity: { type: Number, min: 1, default: 1 }, component: { type: mongoose.Schema.Types.ObjectId, ref: 'Component' }, asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset' } }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

kitSchema.index({ name: 'text', category: 'text', description: 'text' });
module.exports = mongoose.model('Kit', kitSchema);
