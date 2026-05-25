const express = require('express');
const router = express.Router();
const ResourceService = require('../services/ResourceService');

/**
 * GET /api/resources - System resource stats
 */
router.get('/', async (req, res, next) => {
  try {
    const stats = await ResourceService.getStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/resources/agents - Agent process stats
 */
router.get('/agents', async (req, res, next) => {
  try {
    const agents = await ResourceService.getAgentProcesses();
    res.json({ success: true, data: agents });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
