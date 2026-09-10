const mongoose = require('mongoose');

const eulaSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  vendor: { type: String, trim: true },
  license: { type: mongoose.Schema.Types.ObjectId, ref: 'License', default: null },
  asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', default: null },
  assignedTo: { name: { type: String, trim: true }, email: { type: String, trim: true, lowercase: true } },
  status: { type: String, enum: ['pending', 'accepted', 'expired'], default: 'pending', index: true },
  acceptedAt: { type: Date },
  expiresAt: { type: Date },
  documentUrl: { type: String, trim: true },
  notes: { type: String, trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Eula', eulaSchema);
