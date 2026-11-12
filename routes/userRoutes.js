const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { createUserSchema } = require('../utils/schemas');
const controller = require('../controllers/userAdminController');

const router = express.Router();
router.use(requireAuth);
router.get('/', requireRole('admin', 'superadmin'), controller.list);
router.post('/', requireRole('admin', 'superadmin'), validate(createUserSchema), controller.create);
router.use(requireRole('admin', 'superadmin'));
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);
module.exports = router;
