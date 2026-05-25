const express = require('express');
const router = express.Router();
const SkillService = require('../services/SkillService');
const { AppError } = require('../middleware/errorHandler');

/**
 * GET /api/skills - List all skills
 */
router.get('/', (req, res, next) => {
  try {
    const skills = SkillService.getAll();
    res.json({ success: true, data: skills });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/skills/installed - Get all globally installed skills
 */
router.get('/installed', (req, res, next) => {
  try {
    const skills = SkillService.getInstalled();
    res.json({ success: true, data: skills });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/skills/agent/:agentId - Get skills installed for an agent
 */
router.get('/agent/:agentId', (req, res) => {
  const skills = SkillService.getByAgent(req.params.agentId);
  res.json({ success: true, data: skills });
});

/**
 * POST /api/skills/:id/install - Install skill globally
 */
router.post('/:id/install', (req, res, next) => {
  try {
    const { installCmd, name } = req.body;
    const result = SkillService.install(req.params.id, null, { installCmd, name });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/skills/:id/uninstall - Uninstall skill globally
 */
router.delete('/:id/uninstall', (req, res, next) => {
  try {
    const result = SkillService.uninstall(req.params.id, 'all');
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: err.message } });
    }
    next(err);
  }
});

module.exports = router;
