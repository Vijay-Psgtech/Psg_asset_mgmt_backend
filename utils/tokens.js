const jwt = require('jsonwebtoken');

function normalizeInstitutionId(institution) {
  if (!institution) return null;
  if (typeof institution === 'string') return institution;
  return institution._id ? institution._id.toString() : institution.id ? institution.id.toString() : null;
}

function normalizeInstitutionIds(institutions) {
  if (!Array.isArray(institutions)) return [];
  return institutions
    .map((institution) => normalizeInstitutionId(institution))
    .filter(Boolean);
}

function signAccessToken(user) {
  const institutionId = normalizeInstitutionId(user.institution);
  const institutions = normalizeInstitutionIds(user.institutions || []);

  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      institution: institutionId,
      institutions,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_TTL || '15m' }
  );
}

function signRefreshToken(user) {
  const institutionId = normalizeInstitutionId(user.institution);
  const institutions = normalizeInstitutionIds(user.institutions || []);

  return jwt.sign(
    {
      sub: user._id.toString(),
      v: user.refreshTokenVersion,
      institution: institutionId,
      institutions,
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_TTL || '7d' }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
