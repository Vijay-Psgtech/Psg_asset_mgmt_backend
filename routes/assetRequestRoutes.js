const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/assetRequestController');

const router = express.Router();
router.use(requireAuth);
router.get('/mine', controller.listMine);
router.post('/', controller.create);
module.exports = router;
