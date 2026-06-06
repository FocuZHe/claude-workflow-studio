const express = require('express');
const router = express.Router();
const PromptTemplateModel = require('../models/PromptTemplate');
const { AppError } = require('../middleware/errorHandler');
const { requireFields, validateString, validatePagination, validate } = require('../middleware/validation');

/**
 * POST /api/prompt-templates - Create prompt template
 */
router.post('/',
  validate(
    requireFields(['name', 'content']),
    validateString('name', 1, 200),
    validateString('content', 1, 10000),
    validateString('description', 0, 2000)
  ),
  (req: any, res: any, next: any) => {
    try {
      const template = PromptTemplateModel.create(req.body);
      res.status(201).json({ success: true, data: template });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/prompt-templates - List prompt templates
 */
router.get('/',
  validatePagination,
  (req: any, res: any, next: any) => {
    try {
      const { category, search, page, limit } = req.query;
      const result = PromptTemplateModel.findAll({ category, search, page, limit });
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
 * GET /api/prompt-templates/:id - Get template by ID
 */
router.get('/:id', (req: any, res: any, next: any) => {
  try {
    const template = PromptTemplateModel.findById(req.params.id);
    if (!template) {
      throw new AppError('NOT_FOUND', `Prompt template '${req.params.id}' not found`, 404);
    }
    res.json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/prompt-templates/:id - Update template
 */
router.put('/:id',
  validate(
    validateString('name', 1, 200),
    validateString('content', 1, 10000),
    validateString('description', 0, 2000)
  ),
  (req: any, res: any, next: any) => {
    try {
      const result = PromptTemplateModel.update(req.params.id, req.body);
      if (!result) {
        throw new AppError('NOT_FOUND', `Prompt template '${req.params.id}' not found`, 404);
      }
      if (result.error === 'PRESET_READONLY') {
        throw new AppError('PRESET_READONLY', result.message, 403);
      }
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/prompt-templates/:id - Delete template
 */
router.delete('/:id', (req: any, res: any, next: any) => {
  try {
    const result = PromptTemplateModel.delete(req.params.id);
    if (!result) {
      throw new AppError('NOT_FOUND', `Prompt template '${req.params.id}' not found`, 404);
    }
    if (result && result.error === 'PRESET_READONLY') {
      throw new AppError('PRESET_READONLY', result.message, 403);
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/prompt-templates/:id/use - Increment usage count
 */
router.post('/:id/use', (req: any, res: any, next: any) => {
  try {
    const template = PromptTemplateModel.incrementUsage(req.params.id);
    if (!template) {
      throw new AppError('NOT_FOUND', `Prompt template '${req.params.id}' not found`, 404);
    }
    res.json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
