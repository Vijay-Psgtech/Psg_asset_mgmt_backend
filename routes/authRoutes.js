const express = require('express');
const rateLimit = require('express-rate-limit');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { registerSchema, loginSchema } = require('../utils/schemas');
const authController = require('../controllers/authController');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TooManyRequests', message: 'Too many attempts, please try again shortly' },
});

router.post('/register', authLimiter, validate(registerSchema), requireAuth, requireRole('superadmin'), authController.register);
router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', requireAuth, authController.me);
router.patch('/me', requireAuth, authController.updateProfile);

module.exports = router;
