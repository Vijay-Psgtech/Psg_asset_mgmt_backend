const express = require('express');
const router = express.Router();
const {
  getMaintenanceRecords,
  getMaintenanceRecord,
  createMaintenanceRecord,
  updateMaintenanceRecord,
  deleteMaintenanceRecord,
} = require('../controllers/maintenanceController');

const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', getMaintenanceRecords);
router.get('/:id', getMaintenanceRecord);
router.post('/', createMaintenanceRecord);
router.patch('/:id', updateMaintenanceRecord);
router.delete('/:id', deleteMaintenanceRecord);

module.exports = router;