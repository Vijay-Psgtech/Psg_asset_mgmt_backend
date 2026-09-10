const mongoose = require('mongoose');

const requirementSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    order: { type: Number, required: true, default: 0 },
    title: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    status: { type: String, enum: ['core', 'advanced'], default: 'core' },
    description: { type: String, default: '' },
    items: [{ type: String, trim: true }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Requirement', requirementSchema);
