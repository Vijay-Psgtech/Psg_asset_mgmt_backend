const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { accessoryCheckoutSchema } = require('../utils/schemas');
const controller = require('../controllers/accessoryController');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'superadmin'));

router.get('/', controller.getAccessories);
router.get('/:id', controller.getAccessory);
router.post('/', controller.createAccessory);
router.patch('/:id', controller.updateAccessory);
router.delete('/:id', controller.deleteAccessory);
router.post('/:id/checkout', validate(accessoryCheckoutSchema), controller.checkoutAccessory);
router.patch('/:id/checkouts/:checkoutId/checkin', controller.checkinAccessory);

module.exports = router;