const User = require('../models/User');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/tokens');
const { UnauthorizedError, ConflictError, ValidationError } = require('../utils/errors');
const { recordAudit } = require('../utils/audit');
const asyncHandler = require('../utils/asyncHandler');

const REFRESH_COOKIE = 'refresh_token';
const cookieOpts = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
});

// Only intended for bootstrapping the very first admin account.
// In production, gate this behind an existing-superadmin check or disable it after setup.
const register = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;
  const existing = await User.findOne({ email });
  if (existing) throw new ConflictError('An account with this email already exists');

  const assignedRole = role || 'asset_user';

  const user = await User.create({ name, email, password, role: assignedRole });

  req.user = user;
  await recordAudit({ req, action: 'create', entityType: 'User', entityId: user._id, entityLabel: user.email });

  res.status(201).json({ user: user.toSafeJSON() });
});

const login = asyncHandler(async (req, res) => {
  const email = req.body.email.trim().toLowerCase();
  const { password } = req.body;
  const user = await User.findOne({ email, deletedAt: null }).select('+password');

  if (!user || !(await user.comparePassword(password))) {
    await recordAudit({ req, action: 'login_failed', entityType: 'Auth', entityLabel: email });
    throw new UnauthorizedError('Invalid email or password');
  }
  if (!user.active) throw new UnauthorizedError('Account is disabled'); 

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  res.cookie(REFRESH_COOKIE, refreshToken, cookieOpts());
  req.user = user;
  await recordAudit({ req, action: 'login', entityType: 'Auth', entityId: user._id, entityLabel: user.email });

  res.json({ accessToken, user: user.toSafeJSON() });
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

  const user = await User.findById(payload.sub);
  if (!user || user.deletedAt || !user.active || user.refreshTokenVersion !== payload.v) {
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    throw new UnauthorizedError('Refresh token no longer valid');
  }

  const accessToken = signAccessToken(user);
  const newRefreshToken = signRefreshToken(user);
  res.cookie(REFRESH_COOKIE, newRefreshToken, cookieOpts());

  res.json({ accessToken, user: user.toSafeJSON() });
});

const logout = asyncHandler(async (req, res) => {
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  if (req.user) {
    await recordAudit({ req, action: 'logout', entityType: 'Auth', entityId: req.user._id, entityLabel: req.user.email });
  }
  res.status(204).send();
});

const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user.toSafeJSON() });
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

module.exports = { register, login, refresh, logout, me, updateProfile };
