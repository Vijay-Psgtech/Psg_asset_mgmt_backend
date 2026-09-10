const express = require('express');
const router = express.Router();
const {
  getMyDashboard,
  getAssignments,
  getAssignment,
  checkoutAsset,
  checkinAsset,
  deleteAssignment,
} = require('../controllers/assignmentController');

const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/my-dashboard', getMyDashboard);
router.get('/', getAssignments);
router.get('/:id', getAssignment);
router.post('/checkout', checkoutAsset);
router.patch('/:id/checkin', checkinAsset);
router.delete('/:id', deleteAssignment);

module.exports = router;