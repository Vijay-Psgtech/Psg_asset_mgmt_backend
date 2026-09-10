const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const reportController = require('../controllers/reportController');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'superadmin'));
router.get('/overview', reportController.overview);
router.get('/download', reportController.download);
module.exports = router;
