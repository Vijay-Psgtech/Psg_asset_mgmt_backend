const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/accessoryController');

const router = express.Router();
router.use(requireAuth);

router.get('/', controller.getAccessories);
router.get('/:id', controller.getAccessory);
router.post('/', controller.createAccessory);
router.patch('/:id', controller.updateAccessory);
router.delete('/:id', controller.deleteAccessory);
router.post('/:id/checkout', controller.checkoutAccessory);
router.patch('/:id/checkouts/:checkoutId/checkin', controller.checkinAccessory);

module.exports = router;