const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { list, summary } = require('../controllers/requirementController');

const router = express.Router();

router.use(requireAuth);
router.get('/', list);
router.get('/summary', summary);

module.exports = router;
