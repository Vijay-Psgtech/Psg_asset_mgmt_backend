const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ['asset_user', 'admin', 'superadmin'], default: 'admin' },
    menuAccess: { type: [String], default: [] },
    location: { type: String, trim: true },
    phone: { type: String, trim: true },
    website: { type: String, trim: true },
    avatar: { type: String },
    preferences: {
      theme: { type: String, enum: ['royal', 'midnight'], default: 'royal' },
      soundEffects: { type: Boolean, default: true },
      confetti: { type: Boolean, default: true },
    },
    active: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
    refreshTokenVersion: { type: Number, default: 0 }, // bump to invalidate all refresh tokens
  },
  { timestamps: true }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    menuAccess: this.menuAccess || [],
    active: this.active,
    deletedAt: this.deletedAt,
    location: this.location,
    phone: this.phone,
    website: this.website,
    avatar: this.avatar,
    preferences: this.preferences,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
