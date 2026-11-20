const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadCsv } = require('../middleware/csvUpload');
const controller = require('../controllers/importController');
const router = express.Router();
router.use(requireAuth, requireRole('admin', 'superadmin'));
router.post('/:type', uploadCsv, controller.importCsv);
module.exports = router;
