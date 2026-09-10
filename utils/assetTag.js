const Asset = require('../models/Asset');

/**
 * Generates the next sequential asset tag, e.g. AST-000001, AST-000002 ...
 * Looks at the highest existing numeric suffix rather than a counter
 * collection, which is simple and fine at this scale.
 */
async function nextAssetTag() {
  const last = await Asset.findOne({ assetTag: /^AST-\d+$/ })
    .sort({ createdAt: -1 })
    .select('assetTag')
    .lean();

  let nextNum = 1;
  if (last && last.assetTag) {
    const match = last.assetTag.match(/(\d+)$/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  return `AST-${String(nextNum).padStart(6, '0')}`;
}

module.exports = { nextAssetTag };
