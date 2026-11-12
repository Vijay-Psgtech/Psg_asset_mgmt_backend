const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const normalizeInstitutionRef = (institution) => {
  if (!institution) return null;
  if (typeof institution === 'string') return { id: institution, _id: institution };
  if (institution && typeof institution === 'object') {
    const id = institution._id || institution.id || institution.toString?.();
    if (!id) return null;
    return {
      id: id.toString(),
      _id: id.toString(),
      name: institution.name || null,
      code: institution.code || null,
    };
  }
  return null;
};

const normalizeInstitutionList = (institutions) => {
  if (!Array.isArray(institutions)) return [];
  return institutions.map((institution) => normalizeInstitutionRef(institution)).filter(Boolean);
};

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    passwordResetTokenHash: { type: String, select: false, default: null },
    passwordResetExpires: { type: Date, select: false, default: null },
    role: { type: String, enum: ['asset_user', 'admin', 'superadmin'], default: 'admin' },
    institution: { type: mongoose.Schema.Types.ObjectId, ref: 'Institution', default: null },
    institutions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Institution' }],
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
    refreshTokenVersion: { type: Number, default: 0 },
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
  const institution = normalizeInstitutionRef(this.institution);
  const institutions = normalizeInstitutionList(this.institutions || []);

  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    institution,
    institutions,
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
