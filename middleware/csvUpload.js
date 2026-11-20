const multer = require('multer');
const path = require('path');
const { ValidationError } = require('../utils/errors');

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (path.extname(file.originalname).toLowerCase() !== '.csv') {
      return callback(new ValidationError('Upload a .csv file'));
    }
    return callback(null, true);
  },
}).single('file');

function uploadCsv(req, res, next) {
  csvUpload(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'CSV file exceeds the 2 MB limit'
        : 'Upload one CSV file at a time';
      return next(new ValidationError(message, [{ path: 'file', message }]));
    }
    return next(error);
  });
}

module.exports = { uploadCsv };
