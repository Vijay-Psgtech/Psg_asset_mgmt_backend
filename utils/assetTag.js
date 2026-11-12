const Asset = require('../models/Asset');

/**
 * Generates the next sequential asset tag, e.g. AST-000001, AST-000002 ...
 * Looks at the highest existing numeric suffix within the current institution.
 */
async function nextAssetTag({ institutionId } = {}) {
  const filter = { assetTag: /^AST-\d+$/ };
  if (institutionId) {
    filter.institution = institutionId;
  }

  const [last] = await Asset.aggregate([
    { $match: filter },
    {
      $project: {
        numericSuffix: {
          $convert: {
            input: { $arrayElemAt: [{ $split: ['$assetTag', '-'] }, 1] },
            to: 'long',
            onError: 0,
            onNull: 0,
          },
        },
      },
    },
    { $sort: { numericSuffix: -1 } },
    { $limit: 1 },
  ]);
  const nextNum = (last?.numericSuffix || 0) + 1;
  return `AST-${String(nextNum).padStart(6, '0')}`;
}

module.exports = { nextAssetTag };
