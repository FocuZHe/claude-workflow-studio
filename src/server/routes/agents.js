const express = require('express');
const router = express.Router();
const AgentService = require('../services/AgentService');
const AgentModel = require('../models/Agent');
const FileService = require('../services/FileService');
const WorkspaceStateService = require('../services/WorkspaceStateService');
const { AppError } = require('../middleware/errorHandler');
const { requireFields, validateString, validateEnum, validatePagination, validate } = require('../middleware/validation');

// 智能体始终存储在安装目录 data/agents.json，不写入工作区 WORKFLOWS 文件夹
function saveWorkspaceState() {
  // 智能体已改为全局存储，不再写入工作区 WORKFLOWS/agents.json
}

/**
 * POST /api/agents - Create a new agent
 */
router.post('/',
  validate(
    requireFields(['name', 'role']),
    validateString('name', 1, 50),
    validateString('description', 0, 500),
    validateEnum('role', ['developer', 'reviewer', 'tester', 'planner', 'debugger', 'documenter', 'custom'])
  ),
  (req, res, next) => {
    try {
      const agent = AgentService.create(req.body);
      saveWorkspaceState();
      res.status(201).json({ success: true, data: agent });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/agents - List all agents
 */
router.get('/',
  validatePagination,
  (req, res, next) => {
    try {
      const { status, role, page, limit } = req.query;
      const result = AgentService.list({ status, role, page, limit });
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
 * DELETE /api/agents/batch - Batch delete agents
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
        AgentService.delete(id);
        deleted.push(id);
      } catch (e) {
        failed.push(id);
      }
    }
    saveWorkspaceState();
    res.json({ success: true, data: { deleted: deleted.length, failed } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agents/:id - Get agent by ID
 */
router.get('/:id', (req, res, next) => {
  try {
    const agent = AgentService.getById(req.params.id);
    res.json({ success: true, data: agent });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agents/:id/children - Get child agents (two-layer nesting)
 */
router.get('/:id/children', (req, res, next) => {
  try {
    const children = AgentService.getChildren(req.params.id);
    res.json({ success: true, data: children });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/agents/:id - Update agent
 */
router.put('/:id',
  validate(
    validateString('name', 1, 50),
    validateString('description', 0, 500),
    validateEnum('role', ['developer', 'reviewer', 'tester', 'planner', 'debugger', 'documenter', 'custom']),
    validateEnum('status', ['idle', 'busy', 'error', 'offline'])
  ),
  (req, res, next) => {
    try {
      const agent = AgentService.update(req.params.id, req.body);
      saveWorkspaceState();
      res.json({ success: true, data: agent });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/agents/:id - Delete agent
 */
router.delete('/:id', (req, res, next) => {
  try {
    AgentService.delete(req.params.id);
    saveWorkspaceState();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agents/:id/logs - Get agent logs
 */
router.get('/:id/logs', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const logs = AgentService.getLogs(req.params.id, limit);
    res.json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
