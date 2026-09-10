const Requirement = require('../models/Requirement');
const { requirementCatalog, buildRequirementSummary } = require('../utils/requirementCatalog');
const asyncHandler = require('../utils/asyncHandler');

async function getRequirementCatalog() {
  try {
    const requirementList = await Requirement.find({}).sort({ order: 1 }).lean();
    if (requirementList.length) {
      const persistedByCode = new Map(requirementList.map((item) => [item.code, item]));
      const catalogCodes = new Set(requirementCatalog.map((item) => item.code));
      const merged = requirementCatalog.map((item) => persistedByCode.get(item.code) || item);
      const customRecords = requirementList.filter((item) => !catalogCodes.has(item.code));
      return [...merged, ...customRecords].sort((left, right) => left.order - right.order);
    }
  } catch (error) {
    // Fall back to the static catalog if Mongo is unavailable or the collection isn't seeded yet.
  }

  return requirementCatalog;
}

const list = asyncHandler(async (req, res) => {
  const requirements = await getRequirementCatalog();
  res.json({
    requirements,
    total: requirements.length,
    summary: buildRequirementSummary(requirements),
  });
});

const summary = asyncHandler(async (req, res) => {
  const requirements = await getRequirementCatalog();
  res.json({
    ...buildRequirementSummary(requirements),
    status: 'ok',
  });
});

module.exports = { list, summary };
