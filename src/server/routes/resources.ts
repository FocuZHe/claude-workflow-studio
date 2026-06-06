const express = require('express');
const router = express.Router();
const ResourceService = require('../services/ResourceService');

/**
 * GET /api/resources - System resource stats
 */
router.get('/', async (req: any, res: any, next: any) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const stats = await ResourceService.getStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/resources/agents - Agent process stats
 */
router.get('/agents', async (req: any, res: any, next: any) => {
  try {
    const agents = await ResourceService.getAgentProcesses();
    res.json({ success: true, data: agents });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
