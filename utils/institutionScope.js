const { ForbiddenError } = require('./errors');

const getInstitutionId = (req) => {
  if (!req?.user) return null;
  const currentInstitution = req.user.institution;
  if (req.user.role === 'superadmin') {
    return req.query?.institutionId
      || req.body?.institutionId
      || currentInstitution?._id?.toString?.()
      || currentInstitution?.toString?.()
      || currentInstitution
      || null;
  }
  return currentInstitution?._id?.toString?.() || currentInstitution?.toString?.() || currentInstitution || null;
};

const scopeInstitution = (req, query = {}, options = {}) => {
  const scopedQuery = { ...(query || {}) };
  if (!req?.user) throw new ForbiddenError('Authentication required');

  const { includeQueryInstitution = true } = options;
  if (req.user.role === 'superadmin') {
    const institutionId = includeQueryInstitution ? getInstitutionId(req) : null;
    if (institutionId) {
      scopedQuery.institution = institutionId;
    }
    return scopedQuery;
  }

  const institutionId = getInstitutionId(req);
  if (!institutionId) {
    throw new ForbiddenError('Select an institution before accessing this data');
  }
  scopedQuery.institution = institutionId;
  return scopedQuery;
};

const userInstitutionId = (req) => {
  if (!req?.user) return null;
  return req.user.institution?._id?.toString?.() || req.user.institution?.toString?.() || req.user.institution || null;
};

const ensureInstitutionAccess = (req, record) => {
  if (!record || !req?.user) return false;
  if (req.user.role === 'superadmin') return true;
  const currentInstitutionId = userInstitutionId(req);
  if (!currentInstitutionId) return false;
  const recordInstitutionId = record.institution?._id?.toString?.() || record.institution?.toString?.() || record.institution || null;
  return Boolean(recordInstitutionId) && recordInstitutionId === currentInstitutionId;
};

module.exports = { getInstitutionId, scopeInstitution, userInstitutionId, ensureInstitutionAccess };
