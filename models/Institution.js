const mongoose = require('mongoose');

const institutionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
      index: true,
      minlength: 2,
      maxlength: 20,
    },
    status: { type: String, enum: ['active', 'inactive', 'archived'], default: 'active' },
    logo: { type: String, default: '' },
    contactEmail: { type: String, trim: true, default: '' },
    contactPhone: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    settings: {
      currency: { type: String, default: 'INR' },
      timezone: { type: String, default: 'Asia/Kolkata' },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

institutionSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id,
    _id: this._id,
    name: this.name,
    code: this.code,
    status: this.status,
    logo: this.logo,
    contactEmail: this.contactEmail,
    contactPhone: this.contactPhone,
    address: this.address,
    settings: this.settings,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Institution', institutionSchema);
