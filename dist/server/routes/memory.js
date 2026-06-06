"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const MemoryService = require('../services/MemoryService');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
router.get('/list', (req, res, next) => {
    try {
        const { page, limit } = req.query;
        const memories = MemoryService.listMemories();
        // Enrich with workflow name and workspace info
        const WorkflowModel = require('../models/Workflow');
        const WorkspaceManager = require('../services/WorkspaceManager');
        const enriched = memories.map((m) => {
            const wf = WorkflowModel.findById(m.workflowId);
            const wsId = wf?.workspaceId || null;
            let workspaceName = null;
            if (wsId) {
                const ws = WorkspaceManager.getById(wsId);
                workspaceName = ws?.name || null;
            }
            return {
                ...m,
                workflowName: wf?.name || m.workflowId.substring(0, 8) + '...',
                workspaceId: wsId,
                workspaceName
            };
        });
        const p = parseInt(page) || 1;
        const l = Math.min(parseInt(limit) || 20, 100);
        const start = (p - 1) * l;
        const items = enriched.slice(start, start + l);
        res.json({ success: true, data: { items, total: enriched.length, page: p, limit: l } });
    }
    catch (err) {
        next(err);
    }
});
// Search memories by content
router.get('/search', (req, res, next) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.json({ success: true, data: [] });
        }
        const memories = MemoryService.listMemories();
        const WorkflowModel = require('../models/Workflow');
        const WorkspaceManager = require('../services/WorkspaceManager');
        const results = [];
        for (const m of memories) {
            const content = MemoryService.getMemory(m.workflowId);
            if (content && content.toLowerCase().includes(q.toLowerCase())) {
                const wf = WorkflowModel.findById(m.workflowId);
                const wsId = wf?.workspaceId || null;
                let workspaceName = null;
                if (wsId) {
                    const ws = WorkspaceManager.getById(wsId);
                    workspaceName = ws?.name || null;
                }
                results.push({
                    ...m,
                    workflowName: wf?.name || m.workflowId.substring(0, 8) + '...',
                    workspaceId: wsId,
                    workspaceName,
                    preview: content.substring(0, 200)
                });
            }
        }
        res.json({ success: true, data: results });
    }
    catch (err) {
        next(err);
    }
});
router.get('/shared/pool', (req, res, next) => {
    try {
        res.json({ success: true, data: MemoryService.getSharedPool() });
    }
    catch (err) {
        next(err);
    }
});
router.put('/shared/pool', (req, res, next) => {
    try {
        const data = req.body;
        // Validate structure: must be an object, not array/primitive
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new AppError('VALIDATION_ERROR', 'Body must be a JSON object', 400);
        }
        // Limit body size to 100KB
        const jsonSize = JSON.stringify(data).length;
        if (jsonSize > 100 * 1024) {
            throw new AppError('VALIDATION_ERROR', 'Body too large. Max 100KB.', 400);
        }
        MemoryService.updateSharedPool(data);
        res.json({ success: true, data: MemoryService.getSharedPool() });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/memory/:workflowId/runs - List memory entries with tags
router.get('/:workflowId/runs', async (req, res) => {
    try {
        const memory = MemoryService.getMemory(req.params.workflowId);
        if (!memory || !memory.trim()) {
            return res.json({ success: true, data: [] });
        }
        const sections = memory.split(/(?=## Session )/).filter((s) => s.trim());
        const entries = sections.map((s) => {
            const headerMatch = s.match(/^## Session\s+(\S+)(.*)?\n/);
            return {
                timestamp: headerMatch ? headerMatch[1] : '',
                tag: headerMatch && headerMatch[2] ? headerMatch[2].replace(/^\s*\|\s*/, '').trim() : '',
                content: s.replace(/^## Session[^\n]*\n/, '').trim()
            };
        });
        res.json({ success: true, data: entries });
    }
    catch (e) {
        logger.error('Failed to list memory runs:', e);
        res.status(500).json({ success: false, error: '获取记忆列表失败' });
    }
});
router.get('/:workflowId', (req, res, next) => {
    try {
        const content = MemoryService.getMemory(req.params.workflowId);
        res.json({ success: true, data: { content } });
    }
    catch (err) {
        next(err);
    }
});
router.put('/:workflowId', (req, res, next) => {
    try {
        const { content } = req.body;
        if (typeof content !== 'string')
            throw new AppError('VALIDATION_ERROR', 'content must be a string', 400);
        MemoryService.updateMemory(req.params.workflowId, content);
        res.json({ success: true, data: { updated: true } });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:workflowId', (req, res, next) => {
    try {
        MemoryService.deleteMemory(req.params.workflowId);
        res.json({ success: true, data: { removed: true } });
    }
    catch (err) {
        next(err);
    }
});
module.exports = router;
//# sourceMappingURL=memory.js.map