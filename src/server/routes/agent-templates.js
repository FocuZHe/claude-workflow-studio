const express = require('express');
const router = express.Router();
const AgentTemplateService = require('../services/AgentTemplateService');
const { AppError } = require('../middleware/errorHandler');

// GET /api/agent-templates - List all templates
router.get('/', (req, res, next) => {
  try {
    const templates = AgentTemplateService.getAll();
    res.json({ success: true, data: templates });
  } catch (err) {
    next(err);
  }
});

// POST /api/agent-templates - Create custom template
router.post('/', (req, res, next) => {
  try {
    const { name, role, description, model, systemPrompt, temperature, toolPermissions } = req.body;
    if (!name) {
      throw new AppError('VALIDATION_ERROR', 'name is required', 400);
    }
    const template = AgentTemplateService.create({ name, role, description, model, systemPrompt, temperature, toolPermissions });
    res.status(201).json({ success: true, data: template });
  } catch (err) {
    if (err.message?.includes('conflicts')) {
      return next(new AppError('CONFLICT', err.message, 409));
    }
    next(err);
  }
});

// DELETE /api/agent-templates/:id - Delete custom template
router.delete('/:id', (req, res, next) => {
  try {
    const deleted = AgentTemplateService.delete(req.params.id);
    if (!deleted) {
      throw new AppError('NOT_FOUND', '模板未找到', 404);
    }
    res.json({ success: true, data: null });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.message?.includes('Cannot delete')) {
      return next(new AppError('FORBIDDEN', err.message, 403));
    }
    next(err);
  }
});

module.exports = router;
