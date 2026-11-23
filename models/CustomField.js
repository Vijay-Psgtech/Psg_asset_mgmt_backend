const mongoose = require('mongoose');
const { CATEGORIES } = require('./Asset');

const customFieldSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 80 },
    key: { type: String, required: true, trim: true, lowercase: true },
    type: { type: String, enum: ['text', 'textarea', 'number', 'date', 'checkbox', 'select'], required: true },
    options: { type: [String], default: [] },
    categories: { type: [{ type: String, enum: CATEGORIES }], required: true },
    required: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

customFieldSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model('CustomField', customFieldSchema);
