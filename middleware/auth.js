const User = require('../models/User');
const { verifyAccessToken } = require('../utils/tokens');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedError('Missing access token');

    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).populate('institution institutions');
    if (!user || !user.active) throw new UnauthorizedError('Account not found or disabled');

    const institutionId = payload.institution || (user.institution ? user.institution._id?.toString?.() || user.institution.toString() : null);
    if (institutionId && !user.institution) {
      user.institution = institutionId;
    }

    if (user.institution && typeof user.institution === 'object' && user.institution._id && !user.institutions?.some((item) => item._id?.toString() === user.institution._id.toString())) {
      user.institutions = [...(user.institutions || []), user.institution];
    }

    req.user = user;
    req.institution = user.institution;
    next();
  } catch (err) {
    next(new UnauthorizedError('Invalid or expired access token'));
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ForbiddenError('Insufficient permissions'));
    }
    next();
  };
}

function requireInstitution(req, res, next) {
  if (!req.user) return next(new UnauthorizedError('Authentication required'));
  if (req.user.role === 'superadmin') return next();

  const currentInstitutionId = req.user.institution?._id?.toString?.() || req.user.institution?.toString?.() || req.user.institution;
  if (!currentInstitutionId) {
    return next(new ForbiddenError('Select an institution before accessing this data'));
  }

  req.institution = req.user.institution;
  next();
}

module.exports = { requireAuth, requireRole, requireInstitution };
