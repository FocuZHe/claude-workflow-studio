const express = require('express');
const router = express.Router();
const WorkflowTemplateService = require('../services/WorkflowTemplateService');

/**
 * GET /api/workflow-templates - List all templates (supports ?category=xxx filter)
 */
router.get('/', (req: any, res: any, next: any) => {
  try {
    const { category } = req.query;
    const templates = WorkflowTemplateService.getAll(category);
    res.json({ success: true, data: templates });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/workflow-templates/:id - Get template by ID
 */
router.get('/:id', (req: any, res: any, next: any) => {
  try {
    const template = WorkflowTemplateService.getById(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Workflow template '${req.params.id}' not found` } });
    }
    res.json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/workflow-templates/:id/clone - Clone template to create a new workflow
 */
router.post('/:id/clone', (req: any, res: any, next: any) => {
  try {
    const workflow = WorkflowTemplateService.clone(req.params.id);
    res.status(201).json({ success: true, data: workflow });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: err.message } });
    }
    next(err);
  }
});

/**
 * POST /api/workflow-templates - Create a custom template
 */
router.post('/', (req: any, res: any, next: any) => {
  try {
    const { name, category, description, nodes, edges } = req.body;
    const template = WorkflowTemplateService.create({ name, category, description, nodes, edges });
    res.status(201).json({ success: true, data: template });
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.message } });
    }
    next(err);
  }
});

module.exports = router;
