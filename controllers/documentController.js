const fs = require('fs');
const path = require('path');
const Asset = require('../models/Asset');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { recordAudit } = require('../utils/audit');
const { scopeInstitution } = require('../utils/institutionScope');
const { UPLOAD_ROOT } = require('../middleware/upload');
const asyncHandler = require('../utils/asyncHandler');

const toPublicDocument = (document) => ({
  _id: document._id,
  label: document.label,
  category: document.category,
  originalName: document.originalName,
  mimeType: document.mimeType,
  size: document.size,
  uploadedBy: document.uploadedBy,
  uploadedAt: document.uploadedAt,
});

const isWithinDirectory = (directory, candidate) => {
  const relative = path.relative(directory, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const resolveStoredFilePath = async (filePath) => {
  const uploadRoot = path.resolve(UPLOAD_ROOT);
  const candidate = path.resolve(String(filePath || ''));
  if (!isWithinDirectory(uploadRoot, candidate)) {
    throw new NotFoundError('File is missing from storage');
  }

  let realPath;
  try {
    realPath = await fs.promises.realpath(candidate);
  } catch (error) {
    if (error.code === 'ENOENT') throw new NotFoundError('File is missing from storage');
    throw error;
  }

  const realUploadRoot = await fs.promises.realpath(uploadRoot);
  if (!isWithinDirectory(realUploadRoot, realPath)) {
    throw new NotFoundError('File is missing from storage');
  }
  return realPath;
};

// POST /api/assets/:id/documents  (multipart/form-data: file, label, category)
const upload = asyncHandler(async (req, res) => {
  const asset = await Asset.findOne({ _id: req.params.id, ...scopeInstitution(req, {}) });
  if (!asset) throw new NotFoundError('Asset not found');

  if (!req.file) throw new ValidationError('No file was uploaded', [{ path: 'file', message: 'A file is required' }]);

  const { label, category } = req.body;

  const doc = {
    label: label || req.file.originalname,
    category: category || 'other',
    originalName: req.file.originalname,
    fileName: req.file.filename,
    filePath: req.file.path,
    mimeType: req.file.mimetype,
    size: req.file.size,
    uploadedBy: req.user._id,
    uploadedAt: new Date(),
  };

  asset.documents.push(doc);
  await asset.save();

  const saved = asset.documents[asset.documents.length - 1];

  await recordAudit({
    req,
    action: 'document_upload',
    entityType: 'Asset',
    entityId: asset._id,
    entityLabel: `${asset.assetTag} -> ${doc.originalName}`,
    changes: { after: { label: doc.label, category: doc.category, originalName: doc.originalName } },
  });

  res.status(201).json({ document: toPublicDocument(saved) });
});

// GET /api/assets/:id/documents
const list = asyncHandler(async (req, res) => {
  const asset = await Asset.findOne({ _id: req.params.id, ...scopeInstitution(req, {}) }).select('documents assetTag');
  if (!asset) throw new NotFoundError('Asset not found');
  res.json({ documents: asset.documents.map(toPublicDocument) });
});

// GET /api/assets/:id/documents/:docId/download
const download = asyncHandler(async (req, res) => {
  const asset = await Asset.findOne({ _id: req.params.id, ...scopeInstitution(req, {}) }).select('+documents.filePath');
  if (!asset) throw new NotFoundError('Asset not found');

  const doc = asset.documents.id(req.params.docId);
  if (!doc) throw new NotFoundError('Document not found');

  const filePath = await resolveStoredFilePath(doc.filePath);
  res.download(filePath, doc.originalName);
});

// DELETE /api/assets/:id/documents/:docId
const remove = asyncHandler(async (req, res) => {
  const asset = await Asset.findOne({ _id: req.params.id, ...scopeInstitution(req, {}) }).select('+documents.filePath');
  if (!asset) throw new NotFoundError('Asset not found');

  const doc = asset.documents.id(req.params.docId);
  if (!doc) throw new NotFoundError('Document not found');

  const label = doc.label;
  const filePath = await resolveStoredFilePath(doc.filePath);

  doc.deleteOne();
  await asset.save();
  await fs.promises.unlink(filePath);

  await recordAudit({
    req,
    action: 'document_delete',
    entityType: 'Asset',
    entityId: asset._id,
    entityLabel: `${asset.assetTag} -> ${label}`,
  });

  res.status(204).send();
});

// GET /api/documents?category=&search=&page=&limit=
// Aggregates documents across every asset - powers the standalone Documents page.
const listAll = asyncHandler(async (req, res) => {
  const { category, search, page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const matchStage = {};
  if (category) matchStage['documents.category'] = category;
  if (search) {
    const re = new RegExp(search, 'i');
    matchStage.$or = [
      { 'documents.label': re },
      { 'documents.originalName': re },
      { assetTag: re },
      { name: re },
    ];
  }

  const assetScope = scopeInstitution(req, {});
  const basePipeline = [
    { $match: assetScope },
    { $unwind: '$documents' },
    ...(Object.keys(matchStage).length ? [{ $match: matchStage }] : []),
  ];

  const [items, totalAgg] = await Promise.all([
    Asset.aggregate([
      ...basePipeline,
      { $sort: { 'documents.uploadedAt': -1 } },
      { $skip: (pageNum - 1) * limitNum },
      { $limit: limitNum },
      {
        $project: {
          _id: '$documents._id',
          label: '$documents.label',
          category: '$documents.category',
          originalName: '$documents.originalName',
          mimeType: '$documents.mimeType',
          size: '$documents.size',
          uploadedAt: '$documents.uploadedAt',
          assetId: '$_id',
          assetTag: '$assetTag',
          assetName: '$name',
        },
      },
    ]),
    Asset.aggregate([...basePipeline, { $count: 'total' }]),
  ]);

  const total = totalAgg[0]?.total || 0;

  res.json({
    items,
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

module.exports = { upload, list, listAll, download, remove, _resolveStoredFilePath: resolveStoredFilePath };