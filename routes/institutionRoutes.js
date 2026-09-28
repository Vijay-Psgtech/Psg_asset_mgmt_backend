const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const controller = require('../controllers/institutionController');

const router = express.Router();
router.use(requireAuth);
router.get('/', controller.list);
router.post('/', requireRole('superadmin'), controller.create);
module.exports = router;