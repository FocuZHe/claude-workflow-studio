"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const TaskService = require('../services/TaskService');
const { AppError } = require('../middleware/errorHandler');
const { requireFields, validateString, validateEnum, validatePagination, validate } = require('../middleware/validation');
function getBroadcast() {
    return global.__broadcastService;
}
/**
 * POST /api/tasks - Create task
 */
router.post('/', validate(requireFields(['title']), validateString('title', 1, 200), validateString('description', 0, 2000), validateEnum('priority', ['low', 'medium', 'high', 'urgent'])), (req, res, next) => {
    try {
        const task = TaskService.create(req.body);
        getBroadcast()?.broadcast('task.created', { task });
        res.status(201).json({ success: true, data: task });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/tasks - List tasks
 */
router.get('/', validatePagination, (req, res, next) => {
    try {
        const { status, priority, assignedAgentId, workflowId, page, limit } = req.query;
        const result = TaskService.list({ status, priority, assignedAgentId, workflowId, page, limit });
        res.json({
            success: true,
            data: { items: result.items, total: result.total, page: result.page, limit: result.limit }
        });
    }
    catch (err) {
        next(err);
    }
});
/**
 * DELETE /api/tasks/batch - Batch delete tasks
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
                TaskService.delete(id);
                deleted.push(id);
            }
            catch (e) {
                failed.push(id);
            }
        }
        res.json({ success: true, data: { deleted: deleted.length, failed } });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/tasks/:id - Get task by ID
 */
router.get('/:id', (req, res, next) => {
    try {
        const task = TaskService.getById(req.params.id);
        res.json({ success: true, data: task });
    }
    catch (err) {
        next(err);
    }
});
/**
 * PUT /api/tasks/:id - Update task
 */
router.put('/:id', validate(validateString('title', 1, 200), validateString('description', 0, 2000), validateEnum('priority', ['low', 'medium', 'high', 'urgent']), validateEnum('status', ['pending', 'running', 'completed', 'failed', 'cancelled'])), (req, res, next) => {
    try {
        const task = TaskService.update(req.params.id, req.body);
        getBroadcast()?.broadcast('task.updated', { task });
        res.json({ success: true, data: task });
    }
    catch (err) {
        next(err);
    }
});
/**
 * DELETE /api/tasks/:id - Delete task
 */
router.delete('/:id', (req, res, next) => {
    try {
        TaskService.delete(req.params.id);
        getBroadcast()?.broadcast('task.deleted', { taskId: req.params.id });
        res.status(204).send();
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/tasks/:id/execute - Execute task
 */
router.post('/:id/execute', async (req, res, next) => {
    try {
        const result = await TaskService.execute(req.params.id);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/tasks/:id/cancel - Cancel task
 */
router.post('/:id/cancel', (req, res, next) => {
    try {
        const result = TaskService.cancel(req.params.id);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
router.post('/:id/pause', (req, res, next) => {
    try {
        const result = TaskService.pause(req.params.id);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
router.post('/:id/resume', (req, res, next) => {
    try {
        const result = TaskService.resume(req.params.id);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
module.exports = router;
//# sourceMappingURL=tasks.js.map