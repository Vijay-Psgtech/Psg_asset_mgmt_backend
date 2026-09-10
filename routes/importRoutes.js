const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/importController');
const router = express.Router();
router.use(requireAuth);
router.post('/assets', controller.importAssets);
module.exports = router;
