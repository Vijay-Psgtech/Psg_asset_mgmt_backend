const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const controller = require('../controllers/userAdminController');

const router = express.Router();
router.use(requireAuth, requireRole('superadmin'));
router.get('/', controller.list);
router.post('/', controller.create);
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);
module.exports = router;
