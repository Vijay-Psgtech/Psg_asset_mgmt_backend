const express = require('express');
const AuditLog = require('../models/AuditLog');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.use(requireAuth, requireRole('admin', 'superadmin'));

// GET /api/audit-logs?entityType=&action=&page=&limit=
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { entityType, action, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (entityType) filter.entityType = entityType;
    if (action) filter.action = action;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));

    const [items, total] = await Promise.all([
      AuditLog.find(filter)
        .sort('-createdAt')
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ items, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  })
);

module.exports = router;
