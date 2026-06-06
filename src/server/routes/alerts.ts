const express = require('express');
const router = express.Router();
const AlertService = require('../services/AlertService');

/**
 * GET /api/alerts/config - Get alert configuration
 */
router.get('/config', (req: any, res: any, next: any) => {
  try {
    const config = AlertService.getConfig();
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/alerts/config - Update alert configuration
 */
router.put('/config', (req: any, res: any, next: any) => {
  try {
    const config = AlertService.updateConfig(req.body);
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
