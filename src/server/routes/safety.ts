const express = require('express');
const router = express.Router();
const SafetyService = require('../services/SafetyService');
const { AppError } = require('../middleware/errorHandler');
const { requireFields, validateString, validate } = require('../middleware/validation');

/**
 * GET /api/safety/stats - Get safety statistics
 * Aggregates data from multiple service methods to match frontend expectations
 */
router.get('/stats', (req: any, res: any, next: any) => {
  try {
    const safetyService = req.app.get('safetyService');
    if (!safetyService) {
      throw new AppError('SERVICE_ERROR', '安全服务不可用', 500);
    }

    // Get data from service methods
    const safetyScoreData = safetyService.getSafetyScore();
    const threatStats = safetyService.getThreatStats();
    const rules = safetyService.getRules();

    // Map to frontend expected format
    const stats = {
      safeScore: safetyScoreData.score || 0,
      todayThreats: threatStats.todayTotal || 0,
      activeRules: rules.filter((r: any) => r.enabled).length,
      blockedRequests: threatStats.blockedCount || 0
    };

    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/safety/threats - Get threats with filtering and pagination
 */
router.get('/threats', (req: any, res: any, next: any) => {
  try {
    const safetyService = req.app.get('safetyService');
    if (!safetyService) {
      throw new AppError('SERVICE_ERROR', '安全服务不可用', 500);
    }

    const { page = 1, limit = 20, type, severity, startDate, endDate } = req.query;

    // Parse pagination parameters
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const result = safetyService.getThreats({
      page: pageNum,
      limit: limitNum,
      type,
      severity,
      startDate,
      endDate
    });

    res.json({
      success: true,
      data: { items: result.data, total: result.meta.total, page: result.meta.page, limit: result.meta.limit }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/safety/rules - Get all security rules
 */
router.get('/rules', (req: any, res: any, next: any) => {
  try {
    const safetyService = req.app.get('safetyService');
    if (!safetyService) {
      throw new AppError('SERVICE_ERROR', '安全服务不可用', 500);
    }

    const rules = safetyService.getRules();
    res.json({ success: true, data: rules });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/safety/rules - Create a new security rule
 */
router.post('/rules',
  validate(
    requireFields(['name', 'type']),
    validateString('name', 1, 100),
    validateString('description', 0, 500)
  ),
  (req: any, res: any, next: any) => {
    try {
      const safetyService = req.app.get('safetyService');
      if (!safetyService) {
        throw new AppError('SERVICE_ERROR', '安全服务不可用', 500);
      }

      const rule = safetyService.addRule(req.body);
      res.status(201).json({ success: true, data: rule });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/safety/rules/:id - Update an existing security rule
 */
router.put('/rules/:id', (req: any, res: any, next: any) => {
  try {
    const safetyService = req.app.get('safetyService');
    if (!safetyService) {
      throw new AppError('SERVICE_ERROR', '安全服务不可用', 500);
    }

    const { id } = req.params;
    const rule = safetyService.updateRule(id, req.body);

    if (!rule) {
      throw new AppError('NOT_FOUND', `Security rule not found with id: ${id}`, 404);
    }

    res.json({ success: true, data: rule });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/safety/rules/:id - Delete a security rule
 */
router.delete('/rules/:id', (req: any, res: any, next: any) => {
  try {
    const safetyService = req.app.get('safetyService');
    if (!safetyService) {
      throw new AppError('SERVICE_ERROR', '安全服务不可用', 500);
    }

    const { id } = req.params;
    const deleted = safetyService.deleteRule(id);

    if (!deleted) {
      throw new AppError('NOT_FOUND', `Security rule not found with id: ${id}`, 404);
    }

    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
