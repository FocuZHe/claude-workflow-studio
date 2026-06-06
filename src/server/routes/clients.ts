const express = require('express');
const router = express.Router();

/**
 * Client routes - requires broadcastService to be injected
 */
module.exports = function createClientsRouter(broadcastService: any) {
  /**
   * GET /api/clients - List connected clients
   */
  router.get('/', (req: any, res: any, next: any) => {
    try {
      const clientsInfo = broadcastService.getClients();
      res.json({ success: true, data: clientsInfo });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
