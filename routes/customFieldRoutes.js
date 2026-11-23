const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { customFieldIdParamSchema, customFieldListQuerySchema, createCustomFieldSchema, updateCustomFieldSchema } = require('../utils/schemas');
const controller = require('../controllers/customFieldController');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'superadmin'));
router.get('/', validate(customFieldListQuerySchema, 'query'), controller.list);
router.post('/', validate(createCustomFieldSchema), controller.create);
router.put('/:id', validate(customFieldIdParamSchema, 'params'), validate(updateCustomFieldSchema), controller.update);
router.delete('/:id', validate(customFieldIdParamSchema, 'params'), controller.remove);

module.exports = router;
