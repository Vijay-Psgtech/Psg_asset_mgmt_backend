const express = require('express');
const router = express.Router();
const {
  getLicenses,
  getLicense,
  createLicense,
  updateLicense,
  deleteLicense,
  checkoutSeat,
  checkinSeat,
} = require('../controllers/licenseController');

const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', getLicenses);
router.get('/:id', getLicense);
router.post('/', createLicense);
router.patch('/:id', updateLicense);
router.delete('/:id', deleteLicense);
router.post('/:id/checkout', checkoutSeat);
router.delete('/:id/seats/:seatId', checkinSeat);

module.exports = router;