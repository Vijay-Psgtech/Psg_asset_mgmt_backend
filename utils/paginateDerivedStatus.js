const mongoose = require('mongoose');

async function paginateDerivedStatus({
  model,
  filter,
  status,
  page = 1,
  limit = 20,
  computationStages,
  populate = [],
}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
  const aggregateFilter = { ...filter };
  if (typeof aggregateFilter.institution === 'string' && mongoose.isValidObjectId(aggregateFilter.institution)) {
    aggregateFilter.institution = new mongoose.Types.ObjectId(aggregateFilter.institution);
  }

  const pipeline = [
    { $match: aggregateFilter },
    ...computationStages,
    ...(status && status !== 'all' ? [{ $match: { _computedStatus: status } }] : []),
    { $sort: { name: 1, _id: 1 } },
    {
      $facet: {
        data: [
          { $skip: (pageNum - 1) * limitNum },
          { $limit: limitNum },
          { $project: { _id: 1, _computedStatus: 1 } },
        ],
        total: [{ $count: 'value' }],
      },
    },
  ];

  const [result = { data: [], total: [] }] = await model.aggregate(pipeline);
  const entries = result.data || [];
  const ids = entries.map((entry) => entry._id);
  let query = model.find({ _id: { $in: ids } });
  for (const populateOptions of populate) {
    query = query.populate(populateOptions);
  }
  const documents = ids.length ? await query : [];
  const documentsById = new Map(documents.map((document) => [document._id.toString(), document]));
  const data = entries.flatMap((entry) => {
    const document = documentsById.get(entry._id.toString());
    if (!document) return [];
    const item = document.toObject({ virtuals: true });
    item.status = entry._computedStatus;
    return [item];
  });
  const total = result.total?.[0]?.value || 0;

  return {
    data,
    pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
  };
}

module.exports = { paginateDerivedStatus };
