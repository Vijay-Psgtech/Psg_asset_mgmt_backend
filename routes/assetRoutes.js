const express = require('express');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { assetIdParamSchema, assetTagParamSchema, assetListQuerySchema, createAssetSchema, updateAssetSchema } = require('../utils/schemas');
const assetController = require('../controllers/assetController');
const documentRoutes = require('./documentRoutes');

const router = express.Router();

router.use(requireAuth);

router.get('/', validate(assetListQuerySchema, 'query'), assetController.list);
router.get('/tag/:tag', validate(assetTagParamSchema, 'params'), assetController.getByTag);
router.get('/:id', validate(assetIdParamSchema, 'params'), assetController.getById);
router.post('/', requireRole('admin', 'superadmin'), validate(createAssetSchema), assetController.create);
router.put('/:id', requireRole('admin', 'superadmin'), validate(assetIdParamSchema, 'params'), validate(updateAssetSchema), assetController.update);
router.delete('/:id', requireRole('admin', 'superadmin'), validate(assetIdParamSchema, 'params'), assetController.remove);
router.post('/:id/qrcode', requireRole('admin', 'superadmin'), validate(assetIdParamSchema, 'params'), assetController.regenerateQr);

// Document vault: /api/assets/:id/documents
router.use('/:id/documents', documentRoutes);

module.exports = router;