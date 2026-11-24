const mongoose = require('mongoose');

const DEFAULT_CATEGORY_NAMES = [
  'Laptop',
  'Desktop',
  'Monitor',
  'Phone',
  'Tablet',
  'Server',
  'Networking',
  'Peripheral',
  'Software License',
  'Other',
];

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

categorySchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
categorySchema.index({ code: 1 }, { unique: true });

module.exports = mongoose.model('Category', categorySchema);
module.exports.DEFAULT_CATEGORY_NAMES = DEFAULT_CATEGORY_NAMES;
