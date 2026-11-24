const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const controller = require('../controllers/categoryController');

const router = express.Router();
router.use(requireAuth);
router.get('/', controller.list);
router.post('/', requireRole('admin', 'superadmin'), controller.create);
router.put('/:id', requireRole('admin', 'superadmin'), controller.update);
router.delete('/:id', requireRole('admin', 'superadmin'), controller.remove);

module.exports = router;
