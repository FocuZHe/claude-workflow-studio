const express = require('express');
const router = express.Router();
const { AppError } = require('../middleware/errorHandler');

/**
 * Broadcast routes - requires broadcastService to be injected
 */
module.exports = function createBroadcastRouter(broadcastService) {
  /**
   * POST /api/broadcast - Send broadcast message
   */
  router.post('/', (req, res, next) => {
    try {
      const { message, type, data } = req.body;
      if (!message) {
        throw new AppError('VALIDATION_ERROR', 'message is required', 400);
      }
      const validTypes = ['info', 'warning', 'error'];
      if (type && !validTypes.includes(type)) {
        throw new AppError('VALIDATION_ERROR', `type must be one of: ${validTypes.join(', ')}`, 400);
      }

      const sent = broadcastService.broadcastMessage(message, type || 'info', data);
      res.json({ success: true, data: { sent } });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/broadcast/history - Get broadcast history
   */
  router.get('/history', (req, res, next) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const history = broadcastService.getHistory(limit);
      res.json({ success: true, data: history });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
