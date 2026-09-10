const express = require('express');
const router = express.Router();
const { getSummary, getRecentActivity } = require('../controllers/dashboardController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/summary', getSummary);
router.get('/activity', getRecentActivity);

module.exports = router;