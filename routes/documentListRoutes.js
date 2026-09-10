const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { listAll } = require('../controllers/documentController');

const router = express.Router();
router.use(requireAuth);
router.get('/', listAll);

module.exports = router;
