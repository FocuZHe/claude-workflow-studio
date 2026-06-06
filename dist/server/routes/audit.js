"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const AuditService = require('../services/AuditService');
const { validatePagination } = require('../middleware/validation');
/**
 * GET /api/audit-logs - Paginated list of audit logs
 * Query params: action, targetType, sensitive, page, limit
 */
router.get('/', validatePagination, (req, res, next) => {
    try {
        const { action, targetType, sensitive, page, limit } = req.query;
        const parsedPage = page ? parseInt(page) : 1;
        const parsedLimit = limit ? parseInt(limit) : 50;
        const parsedSensitive = sensitive === 'true' ? true : sensitive === 'false' ? false : undefined;
        const result = AuditService.getLogs({
            action,
            targetType,
            sensitive: parsedSensitive,
            page: parsedPage,
            limit: parsedLimit
        });
        res.json({
            success: true,
            data: { items: result.items, total: result.total, page: parsedPage, limit: parsedLimit }
        });
    }
    catch (err) {
        next(err);
    }
});
module.exports = router;
//# sourceMappingURL=audit.js.map