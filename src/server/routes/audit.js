const express = require('express');
const router = express.Router();
const AuditService = require('../services/AuditService');
const { validatePagination } = require('../middleware/validation');

/**
 * GET /api/audit-logs - Paginated list of audit logs
 * Query params: action, targetType, sensitive, page, limit
 */
router.get('/',
  validatePagination,
  (req, res, next) => {
    try {
      const { action, targetType, sensitive, page, limit } = req.query;
      const result = AuditService.getLogs({ action, targetType, sensitive, page, limit });
      res.json({
        success: true,
        data: { items: result.items, total: result.total, page: result.page, limit: result.limit }
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
