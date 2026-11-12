const express = require('express');
const router = express.Router();
const {
  getMaintenanceRecords,
  getMaintenanceRecord,
  createMaintenanceRecord,
  updateMaintenanceRecord,
  deleteMaintenanceRecord,
} = require('../controllers/maintenanceController');

const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin', 'superadmin'));

router.get('/', getMaintenanceRecords);
router.get('/:id', getMaintenanceRecord);
router.post('/', createMaintenanceRecord);
router.patch('/:id', updateMaintenanceRecord);
router.delete('/:id', deleteMaintenanceRecord);

module.exports = router;