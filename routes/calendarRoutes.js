const express = require('express');
const { getCalendarEvents } = require('../controllers/calendarController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.get('/events', getCalendarEvents);

module.exports = router;