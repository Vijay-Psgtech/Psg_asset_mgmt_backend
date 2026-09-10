const User = require('../models/User');
const { verifyAccessToken } = require('../utils/tokens');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedError('Missing access token');

    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (!user || !user.active) throw new UnauthorizedError('Account not found or disabled');

    req.user = user;
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

module.exports = { requireAuth, requireRole };
