const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Institution = require('../models/Institution');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/tokens');
const {
  UnauthorizedError,
  ConflictError,
  ValidationError,
  ForbiddenError,
  ServiceUnavailableError,
} = require('../utils/errors');
const { recordAudit } = require('../utils/audit');
const notifications = require('../utils/notifications');
const logger = require('../utils/logger');
const asyncHandler = require('../utils/asyncHandler');

const REFRESH_COOKIE = 'refresh_token';
const cookieOpts = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
});

const resolveUserInstitution = async (user, requestedInstitutionId) => {
  const institutionIds = Array.isArray(user.institutions)
    ? user.institutions.map((item) => item?._id?.toString?.() || item?.toString?.() || item)
    : [];

  const currentInstitutionId = user.institution?._id?.toString?.() || user.institution?.toString?.() || null;
  const allowedInstitutionIds = [...new Set([...institutionIds, currentInstitutionId].filter(Boolean))];
  if (
    requestedInstitutionId
    && user.role !== 'superadmin'
    && !allowedInstitutionIds.includes(requestedInstitutionId)
  ) {
    throw new ForbiddenError('You do not have access to this institution');
  }

  const institutionId = requestedInstitutionId || currentInstitutionId || institutionIds[0] || null;

  if (!institutionId) {
    user.institutions = user.institutions || [];
    user.institution = user.institution || null;
    return { institution: null, institutions: user.institutions || [] };
  }

  const institutionIdsToLoad = user.role === 'superadmin'
    ? [...new Set([...allowedInstitutionIds, institutionId])]
    : allowedInstitutionIds;
  const institutions = await Institution.find({ _id: { $in: institutionIdsToLoad } }).lean();
  let selectedInstitution = institutions.find((item) => item._id?.toString?.() === institutionId || item.id?.toString?.() === institutionId) || null;

  if (!selectedInstitution && !requestedInstitutionId) {
    selectedInstitution = institutions[0] || null;
  }

  if (!selectedInstitution && user.role === 'superadmin' && requestedInstitutionId) {
    selectedInstitution = await Institution.findById(institutionId).lean();
    if (selectedInstitution) institutions.push(selectedInstitution);
  }

  if (!selectedInstitution && requestedInstitutionId) {
    throw new ForbiddenError('You do not have access to this institution');
  }

  user.institution = selectedInstitution ? selectedInstitution._id || selectedInstitution.id : null;
  user.institutions = selectedInstitution ? institutions.map((item) => item._id || item.id) : [];

  return {
    institution: selectedInstitution,
    institutions: selectedInstitution ? institutions : [],
  };
};

const register = asyncHandler(async (req, res) => {
  const { name, email, password, role, institutionId } = req.body;
  const existing = await User.findOne({ email: String(email || '').trim().toLowerCase() });
  if (existing) throw new ConflictError('An account with this email already exists');

  const assignedRole = role || 'asset_user';
  const user = await User.create({
    name,
    email: String(email || '').trim().toLowerCase(),
    password,
    role: assignedRole,
    institution: institutionId || null,
    institutions: institutionId ? [institutionId] : [],
  });

  req.user = user;
  await recordAudit({ req, action: 'create', entityType: 'User', entityId: user._id, entityLabel: user.email });

  res.status(201).json({ user: user.toSafeJSON() });
});

const login = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { password, institutionId } = req.body;
  let user = await User.findOne({ email, deletedAt: null }).select('+password');

  if (typeof user?.populate === 'function') {
    user = await user.populate('institution institutions');
  }

  if (!user || !(await user.comparePassword(password))) {
    await recordAudit({ req, action: 'login_failed', entityType: 'Auth', entityLabel: email });
    throw new UnauthorizedError('Invalid email or password');
  }
  if (!user.active) throw new UnauthorizedError('Account is disabled');

  const { institution, institutions } = await resolveUserInstitution(user, institutionId);
  user.institution = institution ? institution._id : null;
  user.institutions = institutions.map((item) => item._id || item.id);
  if (institution && typeof user.save === 'function') {
    await user.save();
  }

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  res.cookie(REFRESH_COOKIE, refreshToken, cookieOpts());
  req.user = user;
  await recordAudit({ req, action: 'login', entityType: 'Auth', entityId: user._id, entityLabel: user.email });

  res.json({ accessToken, user: user.toSafeJSON() });
});

const requestPasswordReset = asyncHandler(async (req, res) => {
  if (!notifications.isPasswordResetDeliveryConfigured()) {
    logger.warn('password_reset_email_not_configured', {
      issues: notifications.passwordResetDeliveryIssues(),
    });
    throw new ServiceUnavailableError(
      'Password reset delivery is not configured. Set PASSWORD_RESET_DELIVERY=console for local testing, or configure SMTP_HOST, SMTP_PORT, and MAIL_FROM in server/.env, then restart the server.',
      { expose: true }
    );
  }

  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await User.findOne({ email, deletedAt: null, active: true });

  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    user.passwordResetTokenHash = tokenHash;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    const resetUrl = new URL('/login', process.env.CLIENT_URL || 'http://localhost:5173');
    resetUrl.searchParams.set('resetToken', token);
    const sent = await notifications.sendPasswordResetEmail({
      to: user.email,
      subject: 'Reset your Asset Manager password',
      text: `Use this link to reset your password. It expires in one hour:\n\n${resetUrl.toString()}\n\nIf you did not request a password reset, you can ignore this email.`,
    });

    if (!sent) {
      await User.updateOne(
        { _id: user._id, passwordResetTokenHash: tokenHash },
        { $unset: { passwordResetTokenHash: 1, passwordResetExpires: 1 } }
      );
      logger.warn('password_reset_email_failed', { userId: user._id.toString() });
      throw new ServiceUnavailableError(
        'The password reset email could not be delivered. Check the server SMTP settings and try again.',
        { expose: true }
      );
    }
  }

  res.json({ message: 'If an active account exists for that email, a password reset link has been sent.' });
});

const resetPassword = asyncHandler(async (req, res) => {
  const tokenHash = crypto.createHash('sha256').update(req.body.token).digest('hex');
  const passwordHash = await bcrypt.hash(req.body.password, 12);
  const user = await User.findOneAndUpdate(
    {
      passwordResetTokenHash: tokenHash,
      passwordResetExpires: { $gt: new Date() },
      deletedAt: null,
      active: true,
    },
    {
      $set: { password: passwordHash, passwordResetTokenHash: null, passwordResetExpires: null },
      $inc: { refreshTokenVersion: 1 },
    },
    { new: false }
  );

  if (!user) throw new ValidationError('This password reset link is invalid or has expired. Request a new one.');

  res.json({ message: 'Your password has been reset. You can now sign in with your new password.' });
});

const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw new UnauthorizedError('Missing refresh token');

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  let user = await User.findById(payload.sub);
  if (typeof user?.populate === 'function') {
    user = await user.populate('institution institutions');
  }

  if (!user || user.deletedAt || !user.active || user.refreshTokenVersion !== payload.v) {
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    throw new UnauthorizedError('Refresh token no longer valid');
  }

  const preferredInstitution = payload.institution || user.institution?._id?.toString?.() || null;
  const { institution, institutions } = await resolveUserInstitution(user, preferredInstitution);
  user.institution = institution ? institution._id : null;
  user.institutions = institutions.map((item) => item._id || item.id);
  if (typeof user.save === 'function') {
    await user.save();
  }

  const accessToken = signAccessToken(user);
  const newRefreshToken = signRefreshToken(user);
  res.cookie(REFRESH_COOKIE, newRefreshToken, cookieOpts());

  res.json({ accessToken, user: user.toSafeJSON() });
});

const switchInstitution = asyncHandler(async (req, res) => {
  const { institutionId } = req.body || {};
  if (!institutionId) throw new ValidationError('Institution is required');

  const allowedInstitutionIds = (req.user.institutions || []).map((institution) => institution?._id?.toString?.() || institution?.toString?.() || '');
  const currentInstitutionId = req.user.institution?._id?.toString?.() || req.user.institution?.toString?.() || '';
  const canAccess = req.user.role === 'superadmin' || allowedInstitutionIds.includes(institutionId) || currentInstitutionId === institutionId;

  if (!canAccess) throw new ForbiddenError('You do not have access to this institution');

  const institution = await Institution.findById(institutionId).lean();
  if (!institution) throw new ValidationError('Institution not found');

  req.user.institution = institution._id;
  if (!req.user.institutions.some((item) => item?.toString?.() === institution._id.toString())) {
    req.user.institutions.push(institution._id);
  }
  await req.user.save();

  const accessToken = signAccessToken(req.user);
  const refreshToken = signRefreshToken(req.user);
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOpts());

  res.json({ accessToken, user: req.user.toSafeJSON() });
});

const listUserInstitutions = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('institution institutions');
  const institutions = (user.institutions || []).length ? user.institutions : (user.institution ? [user.institution] : []);
  res.json({ institutions: institutions.map((institution) => ({
    id: institution?._id || institution,
    _id: institution?._id || institution,
    name: institution?.name || null,
    code: institution?.code || null,
    status: institution?.status || 'active',
  })) });
});

const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      const user = await User.findById(payload.sub);
      if (user && user.refreshTokenVersion === payload.v) {
        user.refreshTokenVersion += 1;
        await user.save();
        req.user = req.user || user;
      }
    } catch (error) {
      if (error.name !== 'JsonWebTokenError' && error.name !== 'TokenExpiredError' && error.name !== 'NotBeforeError') {
        throw error;
      }
    }
  }

  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  if (req.user) {
    await recordAudit({ req, action: 'logout', entityType: 'Auth', entityId: req.user._id, entityLabel: req.user.email });
  }
  res.status(204).send();
});

const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('institution institutions');
  res.json({ user: user.toSafeJSON() });
});

const updateProfile = asyncHandler(async (req, res) => {
  const { name, email, currentPassword, newPassword, location, phone, website, avatar, preferences } = req.body;
  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2)) {
    throw new ValidationError('Name must be at least 2 characters');
  }
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('A valid email is required');
  }
  if (newPassword !== undefined) {
    if (!currentPassword) throw new ValidationError('Current password is required');
    if (newPassword.length < 8) throw new ValidationError('New password must be at least 8 characters');
    const userWithPassword = await User.findById(req.user._id).select('+password');
    if (!(await userWithPassword.comparePassword(currentPassword))) {
      throw new UnauthorizedError('Current password is incorrect');
    }
    req.user.password = newPassword;
    req.user.refreshTokenVersion += 1;
  }
  if (name !== undefined) req.user.name = name.trim();
  if (email !== undefined) req.user.email = email.toLowerCase().trim();
  if (location !== undefined) req.user.location = location.trim();
  if (phone !== undefined) req.user.phone = phone.trim();
  if (website !== undefined) req.user.website = website.trim();
  if (avatar !== undefined) req.user.avatar = avatar;
  if (preferences !== undefined) req.user.preferences = { ...req.user.preferences?.toObject?.(), ...preferences };
  await req.user.save();
  res.json({ user: req.user.toSafeJSON() });
});

module.exports = { register, login, requestPasswordReset, resetPassword, refresh, logout, me, updateProfile,
_resolveUserInstitution: resolveUserInstitution, switchInstitution, listUserInstitutions };
