const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { ValidationError } = require('../utils/errors');

// Local disk storage, namespaced per asset.
// NOTE: on Render's free/starter tier the disk is ephemeral - files won't
// survive a redeploy/restart. Swap this `storage` block for a Cloudinary or
// S3 multer-storage engine when you're ready to move off local disk; nothing
// else in this file or the controller needs to change since they only deal
// with the { path, filename } shape multer hands back.
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads', 'assets');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_ROOT, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${unique}${ext}`);
  },
});

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new ValidationError('Unsupported file type', [
      { path: 'file', message: `${file.mimetype} is not allowed. Use PDF, Word, Excel, or an image.` },
    ]));
  }
  cb(null, true);
}

const uploadDocument = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
}).single('file');

module.exports = { uploadDocument, UPLOAD_ROOT };