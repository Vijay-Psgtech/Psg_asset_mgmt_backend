const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const institutionController = require('../controllers/institutionController');

const router = express.Router();

router.use(requireAuth);
router.get('/', institutionController.list);
router.post('/', requireRole('superadmin'), institutionController.create);
router.patch('/:id', requireRole('superadmin'), institutionController.update);

module.exports = router;
