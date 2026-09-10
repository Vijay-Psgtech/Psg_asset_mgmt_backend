const express = require('express');
const { requireAuth } = require('../middleware/auth');
const documentController = require('../controllers/documentController');
const { uploadDocument } = require('../middleware/upload');

const router = express.Router({ mergeParams: true });

router.use(requireAuth);

// Asset-scoped document vault: /api/assets/:id/documents
router.post('/', uploadDocument, documentController.upload);
router.get('/', documentController.list);
router.get('/:docId/download', documentController.download);
router.delete('/:docId', documentController.remove);

module.exports = router;