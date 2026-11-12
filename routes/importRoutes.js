const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const controller = require('../controllers/importController');
const router = express.Router();
router.use(requireAuth, requireRole('admin', 'superadmin'));
router.post('/assets', controller.importAssets);
module.exports = router;
