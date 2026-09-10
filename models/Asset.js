const mongoose = require('mongoose');

const CATEGORIES = ['Laptop', 'Desktop', 'Monitor', 'Phone', 'Tablet', 'Server', 'Networking', 'Peripheral', 'Software License', 'Other'];
const STATUSES = ['available', 'assigned', 'in_maintenance', 'retired', 'lost', 'byod', 'deleted'];
const DOCUMENT_CATEGORIES = ['invoice', 'warranty', 'manual', 'insurance', 'other'];

const documentSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    category: { type: String, enum: DOCUMENT_CATEGORIES, default: 'other' },
    originalName: { type: String, required: true },
    fileName: { type: String, required: true }, // name on disk
    filePath: { type: String, required: true, select: false }, // absolute path, internal use only
    mimeType: { type: String, required: true },
    size: { type: Number, required: true }, // bytes
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);    

const assetSchema = new mongoose.Schema(
  {
    assetTag: { type: String, required: true, unique: true, index: true }, // e.g. AST-000123
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: CATEGORIES, required: true },
    brand: { type: String, trim: true },
    model: { type: String, trim: true },
    serialNumber: { type: String, trim: true, index: true },
    status: { type: String, enum: STATUSES, default: 'available', index: true },

    purchaseDate: { type: Date },
    purchaseCost: { type: Number, min: 0 },
    vendor: { type: String, trim: true },
    warrantyExpiry: { type: Date },    

    location: { type: String, trim: true },
    notes: { type: String, trim: true },

    currentAssignment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', default: null },

    qrCode: { type: String }, // data URL (base64 PNG) generated on creation
    documents: { type: [documentSchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },  
  },
  { timestamps: true }
);

assetSchema.index({ name: 'text', brand: 'text', model: 'text', serialNumber: 'text', assetTag: 'text' });

assetSchema.virtual('isUnderWarranty').get(function isUnderWarranty() {
  return this.warrantyExpiry ? this.warrantyExpiry.getTime() > Date.now() : false;
});

assetSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Asset', assetSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.STATUSES = STATUSES;
module.exports.DOCUMENT_CATEGORIES = DOCUMENT_CATEGORIES;