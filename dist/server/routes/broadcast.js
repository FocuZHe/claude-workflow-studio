"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const { AppError } = require('../middleware/errorHandler');
/**
 * Broadcast routes - requires broadcastService to be injected
 *
 * 兼容两种使用方式：
 * 1. 显式注入：createBroadcastRouter(broadcastService)
 * 2. 全局获取：app.use('/api/broadcast', createBroadcastRouter)
 *    （此时从 global.__broadcastService 获取，由 app.ts 在服务初始化时设置）
 */
module.exports = function createBroadcastRouter(broadcastService) {
    // 无参时返回一个延迟获取 broadcastService 的 router
    // 这样 app.ts 中 app.use('/api/broadcast', createBroadcastRouter) 也能工作
    const getBroadcastService = () => {
        if (broadcastService)
            return broadcastService;
        return global.__broadcastService;
    };
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
            const svc = getBroadcastService();
            const sent = svc.broadcastMessage(message, type || 'info', data);
            res.json({ success: true, data: { sent } });
        }
        catch (err) {
            next(err);
        }
    });
    /**
     * GET /api/broadcast/history - Get broadcast history
     */
    router.get('/history', (req, res, next) => {
        try {
            const limit = parseInt(req.query.limit, 10) || 50;
            const svc = getBroadcastService();
            const history = svc.getHistory(limit);
            res.json({ success: true, data: history });
        }
        catch (err) {
            next(err);
        }
    });
    return router;
};
//# sourceMappingURL=broadcast.js.map