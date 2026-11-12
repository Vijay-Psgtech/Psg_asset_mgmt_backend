const User = require('../models/User');
const Institution = require('../models/Institution');
const { recordAudit } = require('../utils/audit');
const { ValidationError, ConflictError, NotFoundError, ForbiddenError } = require('../utils/errors');

const ROLE_MENU_DEFAULTS = {
  superadmin: ['dashboard', 'super-dashboard', 'my-assets', 'requestable-items', 'requirements', 'assets', 'all-assets', 'add-asset', 'deployed-assets', 'ready-assets', 'pending-assets', 'undeployable-assets', 'byod-assets', 'archived-assets', 'requestable-assets', 'audit-due', 'checkin-due', 'scan-asset', 'quick-scan-checkin', 'bulk-checkout', 'requested-assets', 'deleted-assets', 'scanner-audit', 'assignments', 'maintenance', 'inventory', 'accessories', 'consumables', 'licenses', 'documents', 'components', 'kits', 'import', 'settings', 'custom-fields', 'status-labels', 'categories', 'reports', 'people', 'all-users', 'my-profile', 'audit-log'],
  admin: ['dashboard', 'assets', 'all-assets', 'add-asset', 'deployed-assets', 'ready-assets', 'pending-assets', 'undeployable-assets', 'byod-assets', 'archived-assets', 'requestable-assets', 'audit-due', 'checkin-due', 'scan-asset', 'quick-scan-checkin', 'bulk-checkout', 'requested-assets', 'deleted-assets', 'scanner-audit', 'assignments', 'maintenance', 'requirements', 'reports', 'documents', 'components', 'kits', 'import', 'profile', 'audit-log', 'my-assets', 'requestable-items'],
  asset_user: ['my-assets', 'requestable-items', 'requested-items', 'maintenance', 'documents'],
};

const ALLOWED_MENU_KEYS = new Set(Object.values(ROLE_MENU_DEFAULTS).flat());

function normalizeMenuAccess(menuAccess) {
  if (!Array.isArray(menuAccess)) return [];
  const unique = [...new Set(menuAccess.filter((key) => typeof key === 'string').map((key) => key.trim()).filter(Boolean))];
  return unique.filter((key) => ALLOWED_MENU_KEYS.has(key));
}

function getDefaultMenuAccess(role) {
  return ROLE_MENU_DEFAULTS[role] || [];
}

function resolveMenuAccess(role, menuAccess) {
  const normalized = normalizeMenuAccess(menuAccess);
  return normalized.length ? normalized : getDefaultMenuAccess(role);
}

function safeUser(user) {
  return user.toSafeJSON();
}

function assertAdminCanManageUser(admin, user, changes = {}) {
  if (admin.role !== 'admin') return;

  const institutionId = admin.institution?._id?.toString?.()
    || admin.institution?.toString?.()
    || null;
  const userInstitutionIds = [
    user.institution?._id?.toString?.() || user.institution?.toString?.(),
    ...(user.institutions || []).map((institution) => institution?._id?.toString?.() || institution?.toString?.()),
  ].filter(Boolean);

  if (!institutionId) throw new ForbiddenError('Select an institution before managing users');
  if (user.role !== 'asset_user' || !userInstitutionIds.includes(institutionId)) {
    throw new NotFoundError('User not found');
  }
  if (changes.role !== undefined && changes.role !== 'asset_user') {
    throw new ForbiddenError('Admins cannot assign elevated user roles');
  }
  if (changes.institutionId !== undefined && changes.institutionId !== institutionId) {
    throw new ForbiddenError('Admins cannot move users between institutions');
  }
}

exports.list = async (req, res, next) => {
  try {
    const { search, role, active, deleted } = req.query;
    const filter = {};
    if (req.user?.role === 'admin') {
      const institutionId = req.user.institution?._id?.toString?.()
        || req.user.institution?.toString?.()
        || null;
      if (!institutionId) throw new ForbiddenError('Select an institution before managing users');
      filter.$and = [{
        $or: [{ institution: institutionId }, { institutions: institutionId }],
      }];
    }
    if (role && role !== 'all') filter.role = role;
    if (active !== undefined && active !== 'all') filter.active = active === 'true';
    if (deleted !== undefined && deleted !== 'all') filter.deletedAt = deleted === 'true' ? { $ne: null } : null;
    if (search) {
      const searchFilter = {
        $or: [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }],
      };
      if (filter.$and) filter.$and.push(searchFilter);
      else Object.assign(filter, searchFilter);
    }
    const users = await User.find(filter).populate('institution', 'name code').sort({ createdAt: -1 });
    res.json({ users: users.map(safeUser), total: users.length });
  } catch (error) {
    next(error);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { name, email, password, menuAccess, institutionId } = req.body;
    const role = req.body.role || 'asset_user';
    const normalizedEmail = email.toLowerCase().trim();

    if (req.user?.role === 'admin' && role !== 'asset_user') {
      throw new ForbiddenError('Admins can create asset-user accounts only');
    }
    if (!['asset_user', 'admin', 'superadmin'].includes(role)) {
      throw new ValidationError('Invalid user role');
    }
    if (await User.exists({ email: normalizedEmail })) {
      throw new ConflictError('An account with this email already exists');
    }

    const activeInstitutionId = req.user?.role === 'admin'
      ? req.user.institution?._id || req.user.institution || null
      : institutionId || req.user?.institution?._id || req.user?.institution || null;
    if (req.user?.role === 'admin' && !activeInstitutionId) {
      throw new ForbiddenError('Select an institution before creating users');
    }
    if (req.user?.role === 'superadmin' && !institutionId) {
      throw new ValidationError('Select an institution for the new user');
    }
    if (activeInstitutionId && !(await Institution.exists({ _id: activeInstitutionId, status: 'active' }))) {
      throw new ValidationError('The selected institution is not active or does not exist');
    }
    const resolvedMenuAccess = resolveMenuAccess(role, menuAccess);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role,
      institution: activeInstitutionId || null,
      institutions: activeInstitutionId ? [activeInstitutionId] : [],
      menuAccess: resolvedMenuAccess,
    });
    await recordAudit({
      req,
      action: 'create',
      entityType: 'User',
      entityId: user._id,
      entityLabel: user.email,
      changes: { role: user.role },
    });
    res.status(201).json({ user: safeUser(user) });
  } catch (error) {
    next(error);
  }
};

exports.update = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('+password');
    if (!user) throw new NotFoundError('User not found');
    assertAdminCanManageUser(req.user, user, req.body);
    if (user.deletedAt) throw new ValidationError('This user account has been deleted');
    if (user._id.equals(req.user._id) && req.body.active === false) throw new ValidationError('You cannot disable your own account');
    if (req.body.name !== undefined) {
      if (typeof req.body.name !== 'string' || req.body.name.trim().length < 2) throw new ValidationError('Name must be at least 2 characters');
      user.name = req.body.name.trim();
    }
    if (req.body.email !== undefined) {
      const email = req.body.email.toLowerCase().trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new ValidationError('A valid email is required');
      const duplicate = await User.findOne({ email, _id: { $ne: user._id } });
      if (duplicate) throw new ConflictError('An account with this email already exists');
      user.email = email;
    }
    if (req.body.institutionId !== undefined) {
      const institutionId = req.body.institutionId || null;
      user.institution = institutionId;
      user.institutions = institutionId ? Array.from(new Set([...(user.institutions || []), institutionId])).map((id) => id.toString()) : user.institutions || [];
    }
    if (req.body.role !== undefined) {
      if (!['asset_user', 'admin', 'superadmin'].includes(req.body.role)) throw new ValidationError('Invalid user role');
      if (user._id.equals(req.user._id) && req.body.role !== 'superadmin') throw new ValidationError('You cannot remove your own superadmin role');
      user.role = req.body.role;
      if (req.body.menuAccess === undefined) {
        user.menuAccess = getDefaultMenuAccess(req.body.role);
      }
    }
    if (req.body.menuAccess !== undefined) {
      user.menuAccess = resolveMenuAccess(user.role, req.body.menuAccess);
    }
    if (req.body.active !== undefined) user.active = Boolean(req.body.active);
    if (req.body.password !== undefined) {
      if (req.body.password.length < 8 || req.body.password.length > 128) {
        throw new ValidationError('Password must be between 8 and 128 characters');
      }
      user.password = req.body.password;
      user.refreshTokenVersion += 1;
    }
    await user.save();
    res.json({ user: safeUser(user) });
  } catch (error) {
    next(error);
  }
};

exports.remove = async (req, res, next) => {
  try {
    if (req.params.id === req.user._id.toString()) throw new ValidationError('You cannot delete your own account');
    const user = await User.findById(req.params.id);
    if (!user) throw new NotFoundError('User not found');
    assertAdminCanManageUser(req.user, user);
    if (user.deletedAt) throw new ValidationError('User account is already deleted');
    user.deletedAt = new Date();
    user.active = false;
    await user.save();
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
