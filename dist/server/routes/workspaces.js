"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const WorkspaceManager = require('../services/WorkspaceManager');
const WorkflowModel = require('../models/Workflow');
const FileService = require('../services/FileService');
const WorkspaceStateService = require('../services/WorkspaceStateService');
const { AppError } = require('../middleware/errorHandler');
/**
 * GET /api/workspaces
 * 获取所有活跃工作区列表（含工作流数量）
 */
router.get('/', (req, res) => {
    const workspaces = WorkspaceManager.getActive();
    const fs = require('fs');
    const path = require('path');
    const enriched = workspaces.map((ws) => {
        let count = 0;
        try {
            // 从每个工作区的 WORKFLOWS 目录读取工作流数量
            const wfPath = path.join(ws.path, 'WORKFLOWS', 'workflows.json');
            if (fs.existsSync(wfPath)) {
                const data = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
                count = Array.isArray(data) ? data.length : 0;
            }
        }
        catch (e) {
            // 读取失败时使用内存中的数据
            const allWorkflows = WorkflowModel.findAll({ limit: 99999 });
            const workflowList = Array.isArray(allWorkflows) ? allWorkflows : (allWorkflows.items || []);
            count = workflowList.filter((wf) => wf.workspaceId === ws.id).length;
        }
        return {
            ...ws,
            workflowCount: count
        };
    });
    res.json({ success: true, data: enriched });
});
/**
 * POST /api/workspaces
 * 激活一个工作区
 * Body: { path: string }
 */
router.post('/', (req, res, next) => {
    try {
        const { path: wsPath } = req.body;
        // 参数校验
        if (!wsPath || typeof wsPath !== 'string') {
            throw new AppError('VALIDATION_ERROR', 'path is required and must be a string', 400);
        }
        // 检查是否已激活（按路径去重）
        const existing = WorkspaceManager.findByPath(wsPath);
        if (existing) {
            return res.json({ success: true, data: existing, message: 'Already active' });
        }
        // Update runtimeWorkspaceRoot BEFORE activate so _persist saves the correct path
        FileService.runtimeWorkspaceRoot = require('path').resolve(wsPath);
        const result = WorkspaceManager.activate(wsPath);
        res.status(201).json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
/**
 * DELETE /api/workspaces/:id
 * 停用一个工作区
 */
router.delete('/:id', (req, res, next) => {
    try {
        WorkspaceManager.deactivate(req.params.id);
        res.status(204).send();
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/workspaces/:id/state
 * 获取指定工作区的状态信息
 */
router.get('/:id/state', (req, res, next) => {
    try {
        const ws = WorkspaceManager.getById(req.params.id);
        if (!ws) {
            throw new AppError('NOT_FOUND', '工作区未找到', 404);
        }
        res.json({
            success: true,
            data: {
                id: ws.id,
                path: ws.path,
                name: ws.name,
                activatedAt: ws.activatedAt,
                workflowCount: ws.workflowData ? ws.workflowData.length : 0,
                agentCount: ws.agentData ? ws.agentData.length : 0
            }
        });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/workspaces/:id/workflows
 * 获取指定工作区的工作流列表（不切换当前工作区）
 */
router.get('/:id/workflows', (req, res, next) => {
    try {
        const workflows = WorkspaceManager.getWorkflowsForWorkspace(req.params.id);
        res.json({ success: true, data: workflows });
    }
    catch (err) {
        next(err);
    }
});
module.exports = router;
//# sourceMappingURL=workspaces.js.map