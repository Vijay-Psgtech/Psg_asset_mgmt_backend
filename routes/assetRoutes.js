const express = require('express');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { createAssetSchema, updateAssetSchema } = require('../utils/schemas');
const assetController = require('../controllers/assetController');
const documentRoutes = require('./documentRoutes');

const router = express.Router();

router.use(requireAuth);

router.get('/', assetController.list);
router.get('/tag/:tag', assetController.getByTag);
router.get('/:id', assetController.getById);
router.post('/', validate(createAssetSchema), assetController.create);
router.put('/:id', validate(updateAssetSchema), assetController.update);
router.delete('/:id', assetController.remove);
router.post('/:id/qrcode', assetController.regenerateQr);

// Document vault: /api/assets/:id/documents
router.use('/:id/documents', documentRoutes);

module.exports = router;