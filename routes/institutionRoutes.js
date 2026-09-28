const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const controller = require('../controllers/institutionController');

const router = express.Router();
router.get('/', controller.list);
router.post('/', requireAuth, requireRole('superadmin'), controller.create);
module.exports = router;