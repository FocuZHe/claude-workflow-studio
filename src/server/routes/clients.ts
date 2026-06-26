const express = require('express');
const router = express.Router();

/**
 * Client routes - requires broadcastService to be injected
 *
 * 兼容两种使用方式：
 * 1. 显式注入：createClientsRouter(broadcastService)
 * 2. 全局获取：app.use('/api/clients', createClientsRouter())
 *    （此时从 global.__broadcastService 获取，由 app.ts 在服务初始化时设置）
 */
module.exports = function createClientsRouter(broadcastService: any) {
  const getBroadcastService = (): any => {
    if (broadcastService) return broadcastService;
    return (global as any).__broadcastService;
  };

  /**
   * GET /api/clients - List connected clients
   */
  router.get('/', (req: any, res: any, next: any) => {
    try {
      const svc = getBroadcastService();
      const clientsInfo = svc.getClients();
      res.json({ success: true, data: { count: clientsInfo.length, clients: clientsInfo } });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
