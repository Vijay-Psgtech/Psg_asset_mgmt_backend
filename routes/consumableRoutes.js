const express = require('express');
const { requireAuth } = require('../middleware/auth');
const controller = require('../controllers/consumableController');

const router = express.Router();
router.use(requireAuth);

router.get('/', controller.getConsumables);
router.get('/:id', controller.getConsumable);
router.post('/', controller.createConsumable);
router.patch('/:id', controller.updateConsumable);
router.delete('/:id', controller.deleteConsumable);
router.post('/:id/issue', controller.issueConsumable);

module.exports = router;