const express = require('express');
const router = express.Router();
const TaskQueueService = require('../services/TaskQueueService');
const { AppError } = require('../middleware/errorHandler');
const { requireFields, validateString, validatePagination, validate } = require('../middleware/validation');

/**
 * POST /api/task-queues - Create a task queue
 */
router.post('/',
  validate(
    requireFields(['name', 'workflowId', 'items']),
    validateString('name', 1, 200),
    validateString('description', 0, 2000)
  ),
  (req, res, next) => {
    try {
      const queue = TaskQueueService.create(req.body);
      res.status(201).json({ success: true, data: queue });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/task-queues - List task queues
 */
router.get('/',
  validatePagination,
  (req, res, next) => {
    try {
      const { status, workflowId, page, limit } = req.query;
      const result = TaskQueueService.list({ status, workflowId, page, limit });
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
 * DELETE /api/task-queues/batch - Batch delete task queues
 */
router.delete('/batch', (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'ids must be a non-empty array', 400);
    }
    if (ids.length > 100) {
      throw new AppError('VALIDATION_ERROR', 'Maximum 100 items per batch', 400);
    }
    const deleted = [];
    const failed = [];
    for (const id of ids) {
      try {
        TaskQueueService.delete(id);
        deleted.push(id);
      } catch (e) {
        failed.push(id);
      }
    }
    res.json({ success: true, data: { deleted: deleted.length, failed } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/task-queues/:id - Get queue by ID
 */
router.get('/:id', (req, res, next) => {
  try {
    const queue = TaskQueueService.getById(req.params.id);
    res.json({ success: true, data: queue });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/task-queues/:id - Update queue metadata
 */
router.put('/:id',
  validate(
    validateString('name', 1, 200),
    validateString('description', 0, 2000)
  ),
  (req, res, next) => {
    try {
      const queue = TaskQueueService.update(req.params.id, req.body);
      res.json({ success: true, data: queue });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/task-queues/:id - Delete queue
 */
router.delete('/:id', (req, res, next) => {
  try {
    TaskQueueService.delete(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/task-queues/:id/start - Start queue execution
 */
router.post('/:id/start', async (req, res, next) => {
  try {
    const result = await TaskQueueService.start(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/task-queues/:id/pause - Pause queue
 */
router.post('/:id/pause', (req, res, next) => {
  try {
    const result = TaskQueueService.pause(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/task-queues/:id/resume - Resume queue
 */
router.post('/:id/resume', async (req, res, next) => {
  try {
    const result = await TaskQueueService.resume(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/task-queues/:id/cancel - Cancel queue
 */
router.post('/:id/cancel', (req, res, next) => {
  try {
    const result = TaskQueueService.cancel(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/task-queues/:id/items - Add item to queue
 */
router.post('/:id/items',
  validate(
    requireFields(['input'])
  ),
  (req, res, next) => {
    try {
      const item = TaskQueueService.addItem(req.params.id, req.body);
      res.status(201).json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/task-queues/:id/items/:itemId - Remove item from queue
 */
router.delete('/:id/items/:itemId', (req, res, next) => {
  try {
    TaskQueueService.removeItem(req.params.id, req.params.itemId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
