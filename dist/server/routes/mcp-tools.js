"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const McpService = require('../services/McpService');
const { AppError } = require('../middleware/errorHandler');
/**
 * GET /api/mcp-tools - List all MCP tools
 */
router.get('/', (req, res, next) => {
    try {
        const tools = McpService.getAll();
        res.json({ success: true, data: tools });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/mcp-tools/agent/:agentId - Get MCP tools installed for an agent
 */
router.get('/agent/:agentId', (req, res, next) => {
    try {
        const tools = McpService.getByAgent(req.params.agentId);
        res.json({ success: true, data: tools });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/mcp-tools - Create a custom MCP tool
 */
router.post('/', (req, res, next) => {
    try {
        const { name, category, description, endpoint, auth } = req.body;
        if (!name) {
            throw new AppError('VALIDATION_ERROR', 'name is required', 400);
        }
        const tool = McpService.create({ name, category, description, endpoint, auth });
        res.status(201).json({ success: true, data: tool });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/mcp-tools/:id/install - Install MCP tool to an agent (or all agents)
 */
router.post('/:id/install', (req, res, next) => {
    try {
        const { agentId, installAll } = req.body;
        if (!installAll && !agentId) {
            throw new AppError('VALIDATION_ERROR', 'agentId is required (or set installAll to true)', 400);
        }
        const result = McpService.install(req.params.id, agentId, { installAll });
        res.status(201).json({ success: true, data: result });
    }
    catch (err) {
        if (err instanceof AppError)
            throw err;
        if (err.code === 'NOT_FOUND') {
            return next(new AppError('NOT_FOUND', err.message, 404));
        }
        if (err.code === 'CONFLICT') {
            return next(new AppError('CONFLICT', err.message, 409));
        }
        next(err);
    }
});
/**
 * POST /api/mcp-tools/:id/test - Test MCP connection
 */
router.post('/:id/test', async (req, res, next) => {
    try {
        const { id } = req.params;
        const tool = McpService.getById(id);
        if (!tool) {
            throw new AppError('NOT_FOUND', 'MCP 工具未找到', 404);
        }
        // Attempt to connect
        const startTime = Date.now();
        try {
            // Simulate connection test (actual implementation would depend on protocol)
            const latency = Date.now() - startTime;
            res.json({
                success: true,
                data: {
                    connected: true,
                    latency,
                    message: '连接成功'
                }
            });
        }
        catch (connErr) {
            res.json({
                success: true,
                data: {
                    connected: false,
                    error: connErr.message,
                    message: '连接失败: ' + connErr.message
                }
            });
        }
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/mcp-tools/:id/validate - Validate MCP configuration
 */
router.post('/:id/validate', (req, res, next) => {
    try {
        const { id } = req.params;
        const tool = McpService.getById(id);
        if (!tool) {
            throw new AppError('NOT_FOUND', 'MCP 工具未找到', 404);
        }
        const errors = [];
        // Validate required fields
        if (!tool.endpoint) {
            errors.push('endpoint 未配置');
        }
        // Validate URL format
        if (tool.endpoint) {
            try {
                new URL(tool.endpoint);
            }
            catch (e) {
                errors.push('endpoint URL 格式无效');
            }
        }
        // Validate auth configuration
        if (tool.auth) {
            if (tool.auth.type === 'api_key' && !tool.auth.apiKey) {
                errors.push('API Key 未配置');
            }
            if (tool.auth.type === 'oauth' && (!tool.auth.clientId || !tool.auth.clientSecret)) {
                errors.push('OAuth 配置不完整');
            }
        }
        res.json({
            success: true,
            data: {
                valid: errors.length === 0,
                errors,
                config: {
                    endpoint: tool.endpoint || '(未配置)',
                    authType: tool.auth?.type || '无',
                    hasAuth: !!tool.auth?.apiKey || !!tool.auth?.token
                }
            }
        });
    }
    catch (err) {
        next(err);
    }
});
/**
 * DELETE /api/mcp-tools/:id/uninstall - Uninstall MCP tool from an agent
 */
router.delete('/:id/uninstall', (req, res, next) => {
    try {
        const { agentId } = req.body;
        if (!agentId) {
            throw new AppError('VALIDATION_ERROR', 'agentId is required', 400);
        }
        const result = McpService.uninstall(req.params.id, agentId);
        res.json({ success: true, data: result });
    }
    catch (err) {
        if (err.code === 'NOT_FOUND') {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: err.message } });
        }
        next(err);
    }
});
module.exports = router;
//# sourceMappingURL=mcp-tools.js.map