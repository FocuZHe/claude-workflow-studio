const express = require('express');
const router = express.Router();
const HistoryService = require('../services/HistoryService');
const WorkflowModel = require('../models/Workflow');
const { AppError } = require('../middleware/errorHandler');
const { validatePagination } = require('../middleware/validation');

/**
 * GET /api/history - Paginated list of execution history
 * Query params: status, workflowName, page, limit
 */
router.get('/',
  validatePagination,
  (req, res, next) => {
    try {
      const { status, workflowName, page, limit } = req.query;
      const result = HistoryService.getHistory({ status, workflowName, page, limit });
      res.json({
        success: true,
        data: { items: result.items, total: result.total, page: result.page, limit: result.limit }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/history/:runId - Get execution detail
 */
router.get('/:runId', (req, res, next) => {
  try {
    const detail = HistoryService.getDetail(req.params.runId);
    res.json({ success: true, data: detail });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/history/batch - Batch delete history records
 */
router.delete('/batch', (req, res, next) => {
  try {
    const { runIds } = req.body;
    if (!Array.isArray(runIds) || runIds.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'runIds must be a non-empty array', 400);
    }
    const workflows = WorkflowModel.getAll();
    let removed = 0;
    for (const runId of runIds) {
      for (const wf of workflows) {
        if (WorkflowModel.removeExecutionLog(wf.id, runId)) {
          removed++;
          break;
        }
      }
    }
    res.json({ success: true, data: { removed } });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/history/:runId - Delete single history record
 */
router.delete('/:runId', (req, res, next) => {
  try {
    const { runId } = req.params;
    // Search all workflows for this runId and remove it
    const workflows = WorkflowModel.getAll();
    let removed = false;
    for (const wf of workflows) {
      if (WorkflowModel.removeExecutionLog(wf.id, runId)) {
        removed = true;
        break;
      }
    }
    if (!removed) {
      throw new AppError('NOT_FOUND', '历史记录未找到', 404);
    }
    res.json({ success: true, data: { removed: true } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/history/:runId/replay - Replay a previous execution
 */
router.post('/:runId/replay', (req, res, next) => {
  try {
    const result = HistoryService.replay(req.params.runId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
