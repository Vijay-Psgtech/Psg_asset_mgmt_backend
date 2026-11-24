const Asset = require('../models/Asset');

/**
 * Generates the next sequential asset tag, e.g. AST-000001, AST-000002 ...
 * Looks at the highest existing numeric suffix across all institutions.
 */
async function nextAssetTag({ institutionId } = {}) {
  const filter = { assetTag: /^AST-\d+$/ };
  void institutionId;

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

async function nextAvailableAssetTag({ institutionId } = {}) {
  let candidate = await nextAssetTag({ institutionId });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const filter = { assetTag: candidate };
    void institutionId;
    if (!(await Asset.exists(filter))) return candidate;

    const match = /^AST-(\d+)$/.exec(candidate);
    if (!match) return candidate;
    candidate = `AST-${String(Number(match[1]) + 1).padStart(6, '0')}`;
  }
  throw new Error('Could not allocate a unique asset tag');
}

module.exports = { nextAssetTag, nextAvailableAssetTag };
