"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const config = require('../config');
const WorkflowService = require('../services/WorkflowService');
const WorkflowModel = require('../models/Workflow');
const FileService = require('../services/FileService');
const WorkspaceStateService = require('../services/WorkspaceStateService');
const SnapshotService = require('../services/SnapshotService');
const ApiKeyService = require('../services/ApiKeyService');
const { AppError } = require('../middleware/errorHandler');
const { requireFields, validateString, validateEnum, validatePagination, validate } = require('../middleware/validation');
const logger = require('../utils/logger');
function getBroadcast() {
    return global.__broadcastService;
}
/**
 * Trigger workspace state save for workflows if a workspace is active.
 */
function saveWorkspaceState() {
    try {
        const workspaceRoot = FileService.runtimeWorkspaceRoot;
        if (workspaceRoot) {
            const WorkspaceManager = require('../services/WorkspaceManager');
            const currentWs = WorkspaceManager.findByPath(workspaceRoot);
            const currentWsId = currentWs ? currentWs.id : null;
            // Only save workflows belonging to the current workspace
            const allWorkflows = WorkflowModel.findAll({ page: 1, limit: 9999 }).items;
            const wsWorkflows = currentWsId
                ? allWorkflows.filter((wf) => wf.workspaceId === currentWsId)
                : allWorkflows;
            WorkspaceStateService.saveState(workspaceRoot, 'workflows', wsWorkflows);
        }
    }
    catch (e) {
        console.error('[saveWorkspaceState] Error:', e.message);
    }
}
/**
 * POST /api/workflows - Create workflow
 */
router.post('/', validate(requireFields(['name']), validateString('name', 1, 100), validateString('description', 0, 1000)), (req, res, next) => {
    try {
        const workflow = WorkflowService.create(req.body);
        saveWorkspaceState();
        getBroadcast()?.broadcast('workflow.created', { workflow });
        res.status(201).json({ success: true, data: workflow });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/workflows - List workflows (supports high limit for full listing)
 * 默认只返回当前工作区的工作流，传 workspaceId=all 返回所有工作区
 */
router.get('/', (req, res, next) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const { status, workspaceId } = req.query;
        // 自动过滤当前工作区的工作流
        let filterWorkspaceId = workspaceId;
        if (!workspaceId || workspaceId !== 'all') {
            try {
                const WorkspaceManager = require('../services/WorkspaceManager');
                const ws = WorkspaceManager.findByPath(FileService.runtimeWorkspaceRoot);
                if (ws)
                    filterWorkspaceId = ws.id;
            }
            catch (e) { /* ignore */ }
        }
        else {
            filterWorkspaceId = undefined; // 'all' = 不过滤
        }
        const result = WorkflowService.list({ status, workspaceId: filterWorkspaceId, page, limit });
        res.json({
            success: true,
            data: { items: result.items, total: result.total, page: result.page, limit: result.limit }
        });
    }
    catch (err) {
        next(err);
    }
});
/**
 * DELETE /api/workflows/batch - Batch delete workflows
 */
router.delete('/batch', (req, res, next) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            throw new AppError('VALIDATION_ERROR', 'ids must be a non-empty array', 400);
        }
        // 检查是否有运行中的工作流
        for (const id of ids) {
            const wf = WorkflowModel.findById(id);
            if (wf && (wf.executionStatus === 'running' || wf.executionStatus === 'paused')) {
                throw new AppError('CONFLICT', `工作流 "${wf.name}" 正在运行中，请先停止后再删除`, 409);
            }
        }
        const deleted = [];
        const failed = [];
        for (const id of ids) {
            try {
                WorkflowService.delete(id);
                deleted.push(id);
            }
            catch (e) {
                failed.push(id);
            }
        }
        saveWorkspaceState();
        res.json({ success: true, data: { deleted: deleted.length, failed } });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/batch-clone - Batch clone workflows to other workspaces
 * Body: { workflowIds: string[], targetWorkspaceIds: string[] }
 */
router.post('/batch-clone', (req, res, next) => {
    try {
        const { workflowIds, targetWorkspaceIds } = req.body;
        if (!Array.isArray(workflowIds) || workflowIds.length === 0) {
            throw new AppError('VALIDATION_ERROR', 'workflowIds must be a non-empty array', 400);
        }
        if (!Array.isArray(targetWorkspaceIds) || targetWorkspaceIds.length === 0) {
            throw new AppError('VALIDATION_ERROR', 'targetWorkspaceIds must be a non-empty array', 400);
        }
        const WorkspaceManager = require('../services/WorkspaceManager');
        const activeWorkspaces = WorkspaceManager.getActive();
        const currentWorkspaceRoot = FileService.runtimeWorkspaceRoot;
        const cloned = [];
        const skipped = [];
        const failed = [];
        for (const wfId of workflowIds) {
            const wf = WorkflowModel.findById(wfId);
            if (!wf) {
                failed.push({ id: wfId, error: 'not found' });
                continue;
            }
            for (const targetWsId of targetWorkspaceIds) {
                if (wf.workspaceId === targetWsId) {
                    skipped.push({ id: wfId, name: wf.name, workspaceId: targetWsId, reason: '目标工作区与源工作区相同' });
                    continue;
                }
                const targetWs = activeWorkspaces.find((ws) => ws.id === targetWsId);
                if (!targetWs) {
                    failed.push({ id: wfId, workspaceId: targetWsId, error: 'target workspace not active' });
                    continue;
                }
                // Create a clean clone (no execution memory, no "副本" suffix)
                const { generateId } = require('../utils/id');
                const nodeIdMap = new Map();
                const clone = {
                    ...wf,
                    id: generateId(),
                    workspaceId: targetWsId,
                    folderPath: targetWs.path, // 更新为目标工作区路径
                    status: 'draft',
                    executionStatus: 'idle',
                    executionLog: [],
                    currentRunId: null,
                    context: {},
                    nodes: (wf.nodes || []).map((n) => {
                        const newId = generateId();
                        nodeIdMap.set(n.id, newId);
                        return { ...n, id: newId, status: 'pending', output: null, startedAt: null, completedAt: null, logs: [] };
                    }),
                    edges: (wf.edges || []).map((e) => ({
                        ...e,
                        id: generateId(),
                        source: nodeIdMap.get(e.source) || e.source,
                        target: nodeIdMap.get(e.target) || e.target
                    })),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                if (currentWorkspaceRoot && targetWs.path === currentWorkspaceRoot) {
                    const created = WorkflowModel.create({
                        name: wf.name,
                        description: wf.description,
                        workspaceId: targetWsId,
                        nodes: clone.nodes,
                        edges: clone.edges
                    });
                    cloned.push({ sourceId: wfId, sourceName: wf.name, targetWorkspaceId: targetWsId, clonedId: created.id, clonedName: created.name });
                }
                else {
                    const wfPath = path.join(targetWs.path, 'WORKFLOWS', 'workflows.json');
                    let existing = [];
                    if (fs.existsSync(wfPath)) {
                        try {
                            existing = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
                        }
                        catch (_) {
                            existing = [];
                        }
                    }
                    existing.push(clone);
                    const dir = path.dirname(wfPath);
                    if (!fs.existsSync(dir))
                        fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(wfPath, JSON.stringify(existing, null, 2), 'utf-8');
                    cloned.push({ sourceId: wfId, sourceName: wf.name, targetWorkspaceId: targetWsId, clonedId: clone.id, clonedName: clone.name });
                }
            }
        }
        saveWorkspaceState();
        res.json({ success: true, data: { cloned, skipped, failed } });
    }
    catch (err) {
        next(err);
    }
});
router.get('/list-for-selection', (req, res, next) => {
    try {
        const result = WorkflowModel.findAll({ limit: 99999 });
        const workflows = (result.items || result).map((w) => ({
            id: w.id,
            name: w.name,
            description: w.description,
            nodeCount: (w.nodes || []).length
        }));
        res.json({ success: true, data: workflows });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/workflows/statistics - Get execution statistics
 */
router.get('/statistics', (req, res, next) => {
    try {
        const result = WorkflowModel.findAll({ limit: 99999 });
        const workflows = result.items || result;
        let totalExecutions = 0;
        let completedExecutions = 0;
        let failedExecutions = 0;
        let totalDuration = 0;
        const byWorkflow = [];
        for (const wf of workflows) {
            const logs = wf.executionLog || [];
            const completed = logs.filter((l) => l.status === 'completed').length;
            const failed = logs.filter((l) => l.status === 'failed').length;
            totalExecutions += logs.length;
            completedExecutions += completed;
            failedExecutions += failed;
            let wfDuration = 0;
            for (const log of logs) {
                if (log.startedAt && log.completedAt) {
                    wfDuration += new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime();
                }
            }
            totalDuration += wfDuration;
            byWorkflow.push({
                id: wf.id,
                name: wf.name,
                executions: logs.length,
                completed,
                failed,
                avgDuration: logs.length > 0 ? Math.round(wfDuration / logs.length / 1000) : 0
            });
        }
        res.json({
            success: true,
            data: {
                total: totalExecutions,
                completed: completedExecutions,
                failed: failedExecutions,
                successRate: totalExecutions > 0 ? Math.round(completedExecutions / totalExecutions * 100) : 0,
                avgDuration: totalExecutions > 0 ? Math.round(totalDuration / totalExecutions / 1000) : 0,
                byWorkflow: byWorkflow.sort((a, b) => b.executions - a.executions)
            }
        });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/execution-logs/batch-delete - Batch delete execution logs
 * body: { items: [{ workflowId, runId }] }
 */
router.post('/execution-logs/batch-delete', (req, res, next) => {
    try {
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            throw new AppError('VALIDATION_ERROR', 'items must be a non-empty array', 400);
        }
        let deleted = 0;
        for (const { workflowId, runId } of items) {
            if (!workflowId || !runId)
                continue;
            if (WorkflowModel.removeExecutionLog(workflowId, runId)) {
                deleted++;
            }
        }
        saveWorkspaceState();
        res.json({ success: true, data: { deleted } });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/batch-execute - Batch execute multiple workflows
 * body: { workflowIds: string[], input?: string }
 */
router.post('/batch-execute', async (req, res, next) => {
    try {
        const { workflowIds, input } = req.body;
        if (!Array.isArray(workflowIds) || workflowIds.length === 0) {
            throw new AppError('VALIDATION_ERROR', 'workflowIds must be non-empty array', 400);
        }
        const results = [];
        for (const id of workflowIds) {
            try {
                await WorkflowService.execute(id, input || '');
                results.push({ id, success: true });
            }
            catch (e) {
                results.push({ id, success: false, error: e.message });
            }
        }
        res.json({ success: true, data: results });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/export - Export workflows
 * body: { ids: string[] }
 */
router.post('/export', (req, res, next) => {
    try {
        const { ids, format } = req.body; // format: 'json' | 'diagram'
        if (!Array.isArray(ids) || ids.length === 0) {
            throw new AppError('VALIDATION_ERROR', 'ids must be non-empty array', 400);
        }
        const workflows = [];
        for (const id of ids) {
            const wf = WorkflowModel.findById(id);
            if (wf)
                workflows.push(wf);
        }
        if (format === 'diagram') {
            // Export as ASCII diagram text
            const diagrams = workflows.map((wf) => workflowToDiagram(wf));
            res.json({ success: true, data: { diagrams, exportedAt: new Date().toISOString() } });
        }
        else {
            res.json({ success: true, data: { workflows, exportedAt: new Date().toISOString() } });
        }
    }
    catch (err) {
        next(err);
    }
});
/**
 * Convert workflow to ASCII diagram format
 */
function workflowToDiagram(workflow) {
    const nodes = workflow.nodes || [];
    const edges = workflow.edges || [];
    // Build adjacency for output labels
    const edgeMap = {};
    edges.forEach((e) => {
        if (!edgeMap[e.source])
            edgeMap[e.source] = [];
        edgeMap[e.source].push(e.target);
    });
    // Sort nodes by topological order (using edges)
    const nodeMap = {};
    nodes.forEach((n) => { nodeMap[n.id] = n; });
    // Find start node, then follow edges
    const ordered = [];
    const visited = new Set();
    const startNode = nodes.find((n) => n.type === 'start') || nodes[0];
    function traverse(nodeId) {
        if (!nodeId || visited.has(nodeId))
            return;
        visited.add(nodeId);
        const node = nodeMap[nodeId];
        if (node)
            ordered.push(node);
        const targets = edgeMap[nodeId] || [];
        targets.forEach((tid) => traverse(tid));
    }
    if (startNode)
        traverse(startNode.id);
    // Add any unvisited nodes
    nodes.forEach((n) => { if (!visited.has(n.id))
        ordered.push(n); });
    // Build diagram
    const lines = [];
    const boxW = 16; // inner width of box
    function padCenter(str, w) {
        const s = str.substring(0, w);
        const pad = w - s.length;
        const left = Math.floor(pad / 2);
        return ' '.repeat(left) + s + ' '.repeat(pad - left);
    }
    function makeBox(label, desc) {
        const top = '┌' + '─'.repeat(boxW) + '┐';
        const mid = '│' + padCenter(label, boxW) + '│';
        let bottom;
        if (desc) {
            const descLine = '│' + padCenter(desc, boxW) + '│';
            bottom = '└' + '─'.repeat(boxW) + '┘';
            return [top, mid, descLine, bottom];
        }
        bottom = '└' + '─'.repeat(boxW) + '┘';
        return [top, mid, bottom];
    }
    for (let i = 0; i < ordered.length; i++) {
        const node = ordered[i];
        const label = node.label || node.id;
        const desc = node.config?.systemPrompt?.substring(0, boxW) || '';
        if (node.type === 'start') {
            lines.push(label || '开始');
        }
        else if (node.type === 'end') {
            lines.push('');
            lines.push(...makeBox(label || '结束', ''));
        }
        else {
            lines.push('');
            lines.push('      │');
            lines.push('      ▼');
            lines.push(...makeBox(label, desc));
        }
        // Add arrow to next node if not last
        if (i < ordered.length - 1 && ordered[i + 1].type !== 'end') {
            // Arrow already added via ▼ above
        }
    }
    return {
        name: workflow.name,
        description: workflow.description,
        text: lines.join('\n')
    };
}
/**
 * POST /api/workflows/import - Import workflows
 * body: { workflows: object[], isGlobal?: boolean }
 */
router.post('/import', (req, res, next) => {
    try {
        const { workflows, isGlobal } = req.body;
        if (!Array.isArray(workflows)) {
            throw new AppError('VALIDATION_ERROR', 'workflows must be an array', 400);
        }
        const imported = [];
        for (const wf of workflows) {
            // Determine workspaceId for non-global imports
            let workspaceId = undefined;
            if (isGlobal) {
                workspaceId = null;
            }
            else {
                try {
                    const WorkspaceManager = require('../services/WorkspaceManager');
                    const active = WorkspaceManager.getActive();
                    const currentWorkspaceRoot = FileService.runtimeWorkspaceRoot;
                    const currentWs = active.find((ws) => ws.path === currentWorkspaceRoot);
                    if (currentWs)
                        workspaceId = currentWs.id;
                }
                catch (e) { /* fallback to null */ }
            }
            const newWf = WorkflowModel.create({ ...wf, id: undefined, isGlobal: !!isGlobal, workspaceId });
            imported.push(newWf);
        }
        saveWorkspaceState();
        res.json({ success: true, data: imported });
    }
    catch (err) {
        next(err);
    }
});
// ---- Import/Export .md (Claude Code Workflows) ----
/**
 * POST /api/workflows/import-md - Import a Claude Code .md workflow
 * body: { content: string, name?: string, workspaceId?: string }
 */
router.post('/import-md', (req, res, next) => {
    try {
        const { content, name, workspaceId } = req.body;
        if (!content || typeof content !== 'string') {
            throw new AppError('VALIDATION_ERROR', 'content must be a non-empty string', 400);
        }
        // Limit import size to 500KB
        if (content.length > 500 * 1024) {
            throw new AppError('VALIDATION_ERROR', 'Content too large. Max 500KB.', 400);
        }
        if (name && typeof name === 'string' && name.length > 200) {
            throw new AppError('VALIDATION_ERROR', 'Name too long. Max 200 chars.', 400);
        }
        const WorkflowInteropService = require('../services/WorkflowInteropService');
        const parsed = WorkflowInteropService.parseMarkdown(content);
        const dag = WorkflowInteropService.toWorkflowDag(parsed);
        const workflowName = name || parsed.description || '导入的工作流';
        // Determine workspaceId
        let wsId = workspaceId || null;
        if (!wsId) {
            try {
                const WorkspaceManager = require('../services/WorkspaceManager');
                const active = WorkspaceManager.getActive();
                const currentWorkspaceRoot = FileService.runtimeWorkspaceRoot;
                const currentWs = active.find((ws) => ws.path === currentWorkspaceRoot);
                if (currentWs)
                    wsId = currentWs.id;
            }
            catch (e) { /* fallback to null */ }
        }
        const workflow = WorkflowModel.create({
            name: workflowName,
            description: parsed.description,
            workspaceId: wsId,
            nodes: dag.nodes,
            edges: dag.edges
        });
        saveWorkspaceState();
        res.status(201).json({ success: true, data: workflow, parsed });
    }
    catch (err) {
        next(err);
    }
});
// ---- Timeline & Natural Language routes ----
/**
 * GET /api/workflows/timeline - Timeline view of workflow executions
 */
router.get('/timeline', (req, res, next) => {
    try {
        const result = WorkflowModel.findAll({ limit: 99999 });
        const workflows = result.items || result;
        const events = [];
        for (const wf of workflows) {
            for (const log of (wf.executionLog || [])) {
                events.push({
                    type: 'execution',
                    workflowId: wf.id,
                    workflowName: wf.name,
                    runId: log.runId,
                    status: log.status,
                    startedAt: log.startedAt,
                    completedAt: log.completedAt,
                    duration: log.startedAt && log.completedAt ? Math.round((new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000) : null
                });
            }
        }
        events.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const start = (page - 1) * limit;
        res.json({ success: true, data: { items: events.slice(start, start + limit), total: events.length, page, limit } });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/create-from-text - Create workflow from natural language via AI
 */
router.post('/create-from-text', async (req, res, next) => {
    try {
        const { description, isGlobal } = req.body;
        if (!description)
            throw new AppError('VALIDATION_ERROR', 'description is required', 400);
        // Determine workspaceId for non-global workflows
        let workspaceId = null;
        if (!isGlobal) {
            try {
                const WorkspaceManager = require('../services/WorkspaceManager');
                const active = WorkspaceManager.getActive();
                const currentWorkspaceRoot = FileService.runtimeWorkspaceRoot;
                const currentWs = active.find((ws) => ws.path === currentWorkspaceRoot);
                if (currentWs)
                    workspaceId = currentWs.id;
            }
            catch (e) { /* fallback to null */ }
        }
        // Try AI-based creation first, fallback to diagram parser for ASCII art
        let workflowData;
        if (/[┌└│├┤┬┴▶▼─]/.test(description)) {
            // ASCII art diagram — deterministic parsing
            workflowData = parseDiagram(description);
        }
        else {
            // Natural language — use Claude Haiku to generate structured JSON
            workflowData = await generateWorkflowByAI(description);
        }
        // Apply isGlobal and workspaceId
        workflowData.isGlobal = !!isGlobal;
        workflowData.workspaceId = isGlobal ? null : workspaceId;
        const created = WorkflowModel.create(workflowData);
        saveWorkspaceState();
        res.status(201).json({ success: true, data: created });
    }
    catch (err) {
        next(err);
    }
});
/**
 * 使用Claude Agent SDK生成工作流JSON
 */
async function generateWorkflowByAI(description) {
    const { query } = require('@anthropic-ai/claude-agent-sdk');
    // Show globally installed Skills for AI to reference
    let skillsHint = '';
    try {
        const SkillService = require('../services/SkillService');
        const installedSkills = SkillService.getInstalled();
        if (installedSkills.length > 0) {
            const tooMany = installedSkills.length > 50;
            const skillLines = tooMany
                ? '过多已安装技能（' + installedSkills.length + '个），仅列出名称：\n' + installedSkills.map((s) => s.name).join('、')
                : installedSkills.map((s) => `${s.name}（${(s.description || '').substring(0, 30)}）`).join('\n');
            skillsHint = `\n\n已安装Skills：\n${skillLines}\n\n在agent节点的skillNames数组中填入匹配的Skill名称。`;
        }
    }
    catch (_) { }
    // Show existing Agents for potential binding
    let agentHint = '';
    try {
        const AgentModel = require('../models/Agent');
        const all = AgentModel.findAll?.({ limit: 100 }) || {};
        const agents = Array.isArray(all.items) ? all.items : (all.data || []);
        if (agents.length > 0) {
            const lines = agents.map((a) => `- "${a.name}" (id: ${a.id}, role: ${a.role}${a.skillNames?.length > 0 ? ', Skills: ' + a.skillNames.join(', ') : ''})`).join('\n');
            agentHint = `\n\n已有Agent（可绑定）：\n${lines}\n\n如果节点任务与已有Agent匹配，设置agentId绑定它。`;
        }
    }
    catch (_) { }
    const systemPromptContent = `你是一个工作流设计专家。用户会用自然语言描述想要的工作流，你需要将其转换为结构化的JSON格式。${agentHint}

返回格式要求（只返回JSON，不要任何其他文字）：
{
  "name": "工作流名称（简短，不超过20字）",
  "description": "工作流描述",
  "nodes": [
    {
      "id": "n1",
      "label": "节点名称（简短，不超过10字）",
      "type": "节点类型",
      "agentId": "可选的已有Agent的id，如果匹配则绑定，不匹配则省略此字段",
      "skillNames": ["可选，从已安装Skills中选择匹配的Skill名称，如'代码审查'、'安全审查'"],
      "config": { "systemPrompt": "该节点的详细系统提示词/任务描述", "model": "模型别名" },
      "defaultPrompt": "",
      "requiresInput": false,
      "position": { "x": 数字, "y": 数字 }
    }
  ],
  "edges": [
    { "id": "e1", "source": "节点id", "target": "节点id", "label": "可选标签（condition节点的分支标签为'true'或'false'）" }
  ]
}

节点类型说明：
- "start": 开始节点（必须有，1个）— 工作流入口
- "end": 结束节点（必须有，1个）— 工作流出口
- "agent": Agent节点 — 执行具体任务的AI节点
- "evaluator": 自治判断节点 — AI审查代码/内容，返回JSON格式的pass/fail判断
- "approval": 审批节点 — 需要人工审核确认时使用
- "subworkflow": 子工作流节点 — 引用其他工作流，在config.subWorkflowId中指定

模型选择规则：
- "opus": 最强模型 — 复杂分析、架构设计
- "sonnet": 平衡模型 — 常规开发、代码编写（默认）
- "haiku": 快速模型 — 简单分类、快速检索

只输出JSON，不要有任何额外文字或解释。`;
    // 使用 resolveModel 获取实际模型ID
    const resolvedModel = ApiKeyService.resolveModel('haiku');
    // 读取Claude CLI配置中的环境变量
    let claudeEnv = {};
    try {
        const settingsPath = path.join(require('os').homedir(), '.claude', 'settings.json');
        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            if (settings.env) {
                claudeEnv = settings.env;
            }
        }
    }
    catch (e) {
        logger.warn('Failed to read Claude CLI settings:', e);
    }
    let output = '';
    try {
        // 使用Claude Agent SDK的query函数
        const abortController = new AbortController();
        // 设置超时
        const timeout = setTimeout(() => {
            abortController.abort('TIMEOUT');
        }, 90 * 1000);
        // 使用临时目录作为cwd，避免SDK扫描项目目录
        const fs = require('fs');
        const os = require('os');
        const aiWorkflowDir = path.join(os.tmpdir(), 'claude-ai-workflow-' + Date.now());
        fs.mkdirSync(aiWorkflowDir, { recursive: true });
        for await (const message of query({
            prompt: `用户描述：\n${description}`,
            options: {
                cwd: aiWorkflowDir,
                model: resolvedModel,
                systemPrompt: systemPromptContent,
                permissionMode: 'bypassPermissions',
                maxTurns: 5,
                abortController: abortController,
                env: { ...process.env, ...claudeEnv },
            }
        })) {
            // 处理assistant消息（注意：消息在message.message.content中）
            if (message.type === 'assistant') {
                const content = message.message?.content || [];
                for (const block of content) {
                    if (block.type === 'text' && block.text) {
                        output += block.text;
                    }
                }
            }
            // 处理result消息
            else if (message.type === 'result') {
                if (message.subtype === 'success' && message.result) {
                    if (!output) {
                        output = message.result;
                    }
                }
                else if (message.subtype === 'error') {
                    throw new Error(message.error || 'AI工作流生成失败');
                }
            }
        }
        clearTimeout(timeout);
        // 清理临时目录
        try {
            fs.rmSync(aiWorkflowDir, { recursive: true, force: true });
        }
        catch (e) { /* ignore cleanup errors */ }
        // Parse JSON from AI response
        try {
            // Extract JSON from the response (might be wrapped in markdown code block)
            let jsonStr = output.trim();
            const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
            if (codeBlockMatch)
                jsonStr = codeBlockMatch[1].trim();
            // Try to find JSON object in the response (AI might add preamble text)
            if (!jsonStr.startsWith('{')) {
                const jsonStart = jsonStr.indexOf('{');
                const jsonEnd = jsonStr.lastIndexOf('}');
                if (jsonStart >= 0 && jsonEnd > jsonStart) {
                    jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1);
                }
            }
            const parsed = JSON.parse(jsonStr);
            // Validate basic structure
            if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
                throw new Error('AI返回的JSON缺少nodes数组');
            }
            // Ensure start and end nodes exist
            if (!parsed.nodes.some((n) => n.type === 'start')) {
                parsed.nodes.unshift({
                    id: 'n_start', label: '开始', type: 'start',
                    position: { x: 80, y: 60 },
                    config: {}, defaultPrompt: '', requiresInput: false
                });
            }
            if (!parsed.nodes.some((n) => n.type === 'end')) {
                parsed.nodes.push({
                    id: 'n_end', label: '结束', type: 'end',
                    position: { x: 80, y: 60 + parsed.nodes.length * 200 },
                    config: {}, defaultPrompt: '', requiresInput: false
                });
            }
            // Ensure edges connect nodes properly
            if (!parsed.edges || !Array.isArray(parsed.edges) || parsed.edges.length === 0) {
                const allNodes = parsed.nodes;
                parsed.edges = [];
                let prevId = allNodes.find((n) => n.type === 'start')?.id || allNodes[0]?.id;
                for (const node of allNodes.slice(1)) {
                    parsed.edges.push({
                        id: `e_${prevId}_${node.id}`,
                        source: prevId,
                        target: node.id
                    });
                    prevId = node.id;
                }
            }
            // Normalize node positions
            const NODE_GAP = 200;
            const START_Y = 60;
            const START_X = 80;
            parsed.nodes.forEach((n, i) => {
                if (!n.position || typeof n.position.x !== 'number') {
                    n.position = { x: START_X, y: START_Y + i * NODE_GAP };
                }
                n.config = n.config || {};
                n.defaultPrompt = n.defaultPrompt || '';
                n.requiresInput = n.requiresInput || false;
            });
            logger.info('AI workflow generation successful', { name: parsed.name, nodeCount: parsed.nodes.length });
            return parsed;
        }
        catch (parseErr) {
            logger.error('AI workflow JSON parse failed', { error: parseErr.message, rawOutput: output.substring(0, 500) });
            throw new AppError('AI_ERROR', `AI 生成了无效的工作流格式，请尝试更简洁的描述或稍后再试。原始错误: ${parseErr.message}`, 500);
        }
    }
    catch (err) {
        if (err.message?.includes('TIMEOUT') || err.message?.includes('abort')) {
            throw new AppError('AI_ERROR', 'AI 工作流生成超时（90秒），请尝试更简洁的描述或稍后再试。', 504);
        }
        logger.error('AI workflow generation failed', { error: err.message });
        throw new AppError('AI_ERROR', `AI 工作流生成失败: ${err.message}`, 500);
    }
}
/**
 * Parse structured diagram format (ASCII art with boxes and arrows)
 */
function parseDiagram(text) {
    const lines = text.split('\n');
    const boxNodes = []; // { label, desc }
    // 1. Extract left-side boxes (workflow steps)
    // Strategy: find lines with ┌, then extract content until └
    // For side-by-side boxes (connected by ──▶), only take the left one
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (/┌─+┐/.test(line)) {
            // Find the first box (left box) - content before ──▶ or before second ┌
            const firstBoxMatch = line.match(/┌(─+)┐/);
            if (!firstBoxMatch) {
                i++;
                continue;
            }
            const boxWidth = firstBoxMatch[1].length + 2;
            const boxStart = firstBoxMatch.index;
            const boxContent = [];
            // Collect inner lines
            let j = i + 1;
            while (j < lines.length) {
                const row = lines[j];
                // Check for bottom of box
                if (row.substring(boxStart, boxStart + boxWidth).match(/└─+┘/)) {
                    const bottom = row.substring(boxStart, boxStart + boxWidth).replace(/[└┘─]/g, '').trim();
                    if (bottom)
                        boxContent.push(bottom);
                    break;
                }
                // Extract content from the box's column range
                const segment = row.substring(boxStart, boxStart + boxWidth);
                const inner = segment.replace(/[│├┤]/g, '').trim();
                if (inner)
                    boxContent.push(inner);
                j++;
            }
            if (boxContent.length > 0) {
                // Clean up: remove ──▶ artifacts, stray ─, and extra spaces
                const cleanContent = boxContent.map((s) => s.replace(/─+▶.*/g, '').replace(/[─]/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
                const label = cleanContent[0] || `节点${boxNodes.length + 1}`;
                const desc = cleanContent.slice(1).join(' ');
                boxNodes.push({ label, desc });
            }
            // Skip to after the bottom
            let k = i + 1;
            while (k < lines.length && !/└─+┘/.test(lines[k]))
                k++;
            i = k + 1;
        }
        else {
            i++;
        }
    }
    // 2. Extract text-only lines before boxes (like "用户输入仓库路径")
    const inputDesc = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !/[┌└│├┤┬┴▶▼─]/.test(trimmed) && !/^\s*$/.test(trimmed)) {
            // Pure text line — likely an input description
            if (trimmed.length < 50)
                inputDesc.push(trimmed);
        }
    }
    // 3. Build nodes and edges (sequential, since diagram flows top-down)
    const nodes = [];
    const edges = [];
    let nodeId = 1;
    const NODE_GAP = 220;
    const startX = 80;
    const startY = 60;
    // Start node
    const startPrompt = inputDesc.length > 0 ? inputDesc.join('\n') : '';
    nodes.push({
        id: `n${nodeId}`,
        label: '开始',
        type: 'start',
        agentId: '',
        position: { x: startX, y: startY },
        config: {},
        defaultPrompt: startPrompt,
        requiresInput: !!startPrompt
    });
    const startId = `n${nodeId}`;
    nodeId++;
    // Agent nodes from boxes
    let prevId = startId;
    for (let k = 0; k < boxNodes.length; k++) {
        const bn = boxNodes[k];
        const nodeIdStr = `n${nodeId}`;
        const isLast = k === boxNodes.length - 1;
        const isOutput = /输出|聚合|报告|PR|结果/.test(bn.label);
        nodes.push({
            id: nodeIdStr,
            label: bn.label.substring(0, 20),
            type: isLast && isOutput ? 'end' : 'agent',
            agentId: '',
            position: { x: startX, y: startY + (k + 1) * NODE_GAP },
            config: { systemPrompt: bn.desc || bn.label },
            defaultPrompt: '',
            requiresInput: false
        });
        edges.push({
            id: `e${nodeId - 1}`,
            source: prevId,
            target: nodeIdStr
        });
        prevId = nodeIdStr;
        nodeId++;
    }
    // End node if last box wasn't already 'end'
    const lastNode = nodes[nodes.length - 1];
    if (lastNode.type !== 'end') {
        nodes.push({
            id: `n${nodeId}`,
            label: '结束',
            type: 'end',
            agentId: '',
            position: { x: startX, y: startY + (boxNodes.length + 1) * NODE_GAP },
            config: {},
            defaultPrompt: '',
            requiresInput: false
        });
        edges.push({ id: `e${nodeId - 1}`, source: prevId, target: `n${nodeId}` });
    }
    // Extract workflow name from first meaningful text
    const nameSource = boxNodes[0]?.label || inputDesc[0] || text.substring(0, 30);
    return {
        name: nameSource.substring(0, 30),
        description: text.substring(0, 200),
        nodes,
        edges
    };
}
/**
 * Parse simple natural language text (original behavior)
 */
// ---- Snapshot routes (must be before /:id routes) ----
/**
 * POST /api/workflows/:id/snapshots - Create a workflow snapshot
 */
router.post('/:id/snapshots', (req, res, next) => {
    try {
        const snapshot = SnapshotService.save(req.params.id, req.body.name);
        res.status(201).json({ success: true, data: snapshot });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/workflows/:id/snapshots - List workflow snapshots
 */
router.get('/:id/snapshots', (req, res, next) => {
    try {
        res.json({ success: true, data: SnapshotService.list(req.params.id) });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/:id/snapshots/:snapshotId/restore - Restore workflow from snapshot
 */
router.post('/:id/snapshots/:snapshotId/restore', (req, res, next) => {
    try {
        const result = SnapshotService.restore(req.params.id, req.params.snapshotId);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
/**
 * DELETE /api/workflows/:id/snapshots/:snapshotId - Delete a snapshot
 */
router.delete('/:id/snapshots/:snapshotId', (req, res, next) => {
    try {
        SnapshotService.delete(req.params.id, req.params.snapshotId);
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/:id/resume-from-checkpoint - Resume workflow from checkpoint
 * body: { runId? } (optional, defaults to latest checkpoint)
 */
router.post('/:id/resume-from-checkpoint', async (req, res, next) => {
    try {
        const { id } = req.params;
        const workflow = WorkflowModel.findById(id);
        if (!workflow)
            throw new AppError('NOT_FOUND', '工作流未找到', 404);
        const CheckpointService = require('../services/CheckpointService');
        const checkpoint = req.body.runId
            ? CheckpointService.loadCheckpoint(id, req.body.runId)
            : CheckpointService.getLatestCheckpoint(id);
        if (!checkpoint)
            throw new AppError('NOT_FOUND', '未找到检查点', 404);
        const result = await WorkflowService.resumeFromCheckpoint(id, checkpoint);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/workflows/:id/checkpoints - List checkpoints for a workflow
 */
router.get('/:id/checkpoints', (req, res, next) => {
    try {
        const CheckpointService = require('../services/CheckpointService');
        const checkpoints = CheckpointService.listCheckpoints(req.params.id);
        res.json({ success: true, data: checkpoints });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/workflows/:id/export-md - Export workflow as Claude Code .md format
 */
router.get('/:id/export-md', (req, res, next) => {
    try {
        const workflow = WorkflowModel.findById(req.params.id);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${req.params.id}' not found`, 404);
        }
        const WorkflowInteropService = require('../services/WorkflowInteropService');
        const md = WorkflowInteropService.toMarkdown(workflow);
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(workflow.name || 'workflow')}.md"`);
        res.send(md);
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/workflows/:id - Get workflow by ID
 */
router.get('/:id', (req, res, next) => {
    try {
        const workflow = WorkflowService.getById(req.params.id);
        res.json({ success: true, data: workflow });
    }
    catch (err) {
        next(err);
    }
});
/**
 * PUT /api/workflows/:id - Update workflow
 */
router.put('/:id', validate(validateString('name', 1, 100), validateString('description', 0, 1000)), (req, res, next) => {
    try {
        const workflow = WorkflowService.update(req.params.id, req.body);
        saveWorkspaceState();
        getBroadcast()?.broadcast('workflow.updated', { workflow });
        res.json({ success: true, data: workflow });
    }
    catch (err) {
        next(err);
    }
});
/**
 * PUT /api/workflows/:id/rename - Rename workflow
 * body: { name: string }
 */
router.put('/:id/rename', validate(requireFields(['name']), validateString('name', 1, 100)), (req, res, next) => {
    try {
        const { name } = req.body;
        const workflow = WorkflowModel.findById(req.params.id);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${req.params.id}' not found`, 404);
        }
        const updated = WorkflowModel.update(req.params.id, { name });
        saveWorkspaceState();
        res.json({ success: true, data: updated });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/create-in-all - Create workflow in all active workspaces
 * body: { name, description?, nodes?, edges? }
 */
router.post('/create-in-all', validate(requireFields(['name']), validateString('name', 1, 100)), (req, res, next) => {
    try {
        const workflows = WorkflowModel.createInAllWorkspaces(req.body);
        // Only return the workflow belonging to the current workspace
        const currentWsId = (() => {
            try {
                const WorkspaceManager = require('../services/WorkspaceManager');
                const ws = WorkspaceManager.findByPath(FileService.runtimeWorkspaceRoot);
                return ws ? ws.id : null;
            }
            catch (e) {
                return null;
            }
        })();
        const currentWf = currentWsId
            ? workflows.find((wf) => wf.workspaceId === currentWsId)
            : workflows[0];
        res.status(201).json({
            success: true,
            data: currentWf || workflows[0],
            meta: { totalWorkspaces: workflows.length }
        });
    }
    catch (err) {
        next(err);
    }
});
/**
 * DELETE /api/workflows/:id - Delete workflow
 */
router.delete('/:id', (req, res, next) => {
    try {
        const wf = WorkflowModel.findById(req.params.id);
        if (wf && (wf.executionStatus === 'running' || wf.executionStatus === 'paused')) {
            throw new AppError('CONFLICT', '工作流正在运行中，请先停止后再删除', 409);
        }
        WorkflowService.delete(req.params.id);
        saveWorkspaceState();
        getBroadcast()?.broadcast('workflow.deleted', { workflowId: req.params.id });
        res.status(204).send();
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/:id/execute - Execute workflow
 * body: { input?, params?, nodeInputs? }
 */
router.post('/:id/execute', (req, res, next) => {
    try {
        const result = WorkflowService.execute(req.params.id, req.body.input, req.body.params, req.body.nodeInputs);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/workflows/:id/input-required - Get agent nodes that require user input
 */
router.get('/:id/input-required', (req, res, next) => {
    try {
        const result = WorkflowService.getRequiredInputs(req.params.id);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/:id/pause - Pause workflow
 */
router.post('/:id/pause', (req, res, next) => {
    try {
        const result = WorkflowService.pause(req.params.id);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/:id/resume - Resume workflow
 */
router.post('/:id/resume', (req, res, next) => {
    try {
        const result = WorkflowService.resume(req.params.id);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/workflows/:id/status - Get workflow execution status
 */
router.get('/:id/status', (req, res, next) => {
    try {
        const status = WorkflowService.getStatus(req.params.id);
        res.json({ success: true, data: status });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/workflows/:id/execution - Get detailed execution status
 */
router.get('/:id/execution', (req, res, next) => {
    try {
        const execution = WorkflowService.getExecutionStatus(req.params.id);
        res.json({ success: true, data: execution });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/workflows/:id/runs/:runId/node-logs - Get node execution logs for a specific run
 */
router.get('/:id/runs/:runId/node-logs', async (req, res, next) => {
    try {
        const { id, runId } = req.params;
        const workflow = WorkflowModel.findById(id);
        if (!workflow) {
            return res.status(404).json({ success: false, error: '工作流不存在' });
        }
        // Load checkpoint data for this run
        const CheckpointService = require('../services/CheckpointService');
        const checkpoint = CheckpointService.loadCheckpoint(id, runId);
        if (!checkpoint || !checkpoint.completedNodes || Object.keys(checkpoint.completedNodes).length === 0) {
            return res.json({ success: true, data: {} });
        }
        // Build node log map from checkpoint data
        const nodeLogs = {};
        const completedNodes = checkpoint.completedNodes || {};
        for (const [nodeId, nodeData] of Object.entries(completedNodes)) {
            nodeLogs[nodeId] = {
                nodeId,
                status: nodeData.status || 'completed',
                output: nodeData.output || '',
                startedAt: nodeData.startedAt || checkpoint.timestamp || null,
                completedAt: nodeData.completedAt || checkpoint.timestamp || null,
                duration: nodeData.duration || null,
                model: nodeData.model || null,
                tokens: nodeData.tokens || null,
                error: nodeData.error || null
            };
        }
        // Also include node outputs from checkpoint
        const nodeOutputs = checkpoint.nodeOutputs || {};
        for (const [nodeId, output] of Object.entries(nodeOutputs)) {
            if (!nodeLogs[nodeId]) {
                nodeLogs[nodeId] = {
                    nodeId,
                    status: 'completed',
                    output: typeof output === 'string' ? output : JSON.stringify(output),
                    startedAt: checkpoint.timestamp || null,
                    completedAt: checkpoint.timestamp || null,
                    duration: null,
                    model: null,
                    tokens: null,
                    error: null
                };
            }
        }
        res.json({ success: true, data: nodeLogs });
    }
    catch (err) {
        logger.error('Failed to get node logs:', err);
        next(err);
    }
});
/**
 * PUT /api/workflows/:id/folder - Set working folder for a workflow
 */
router.put('/:id/folder', (req, res, next) => {
    try {
        const { folderPath } = req.body;
        // Allow empty/null to clear folderPath (make workflow global)
        if (folderPath === '' || folderPath === null) {
            const workflow = WorkflowService.clearFolder(req.params.id);
            return res.json({ success: true, data: workflow });
        }
        if (!folderPath) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'folderPath is required' }
            });
        }
        const workflow = WorkflowService.setFolder(req.params.id, folderPath);
        res.json({ success: true, data: workflow });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/:id/stop - Stop a running workflow
 */
router.post('/:id/stop', async (req, res, next) => {
    try {
        await WorkflowService.stop(req.params.id);
        res.json({ success: true, data: { status: 'stopped' } });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/:id/skip-node - Skip a failed node and continue execution
 * body: { nodeId }
 */
router.post('/:id/skip-node', async (req, res, next) => {
    try {
        const { nodeId } = req.body;
        if (!nodeId) {
            throw new AppError('VALIDATION_ERROR', 'nodeId is required', 400);
        }
        const result = await WorkflowService.skipNodeAndContinue(req.params.id, nodeId);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/:id/step - Single-step execution
 * body: { nodeId }
 */
router.post('/:id/step', validate(requireFields(['nodeId'])), async (req, res, next) => {
    try {
        const result = await WorkflowService.step(req.params.id, req.body.nodeId);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/:id/simulate - Simulate workflow with mock data
 * body: { mockData? }
 */
router.post('/:id/simulate', async (req, res, next) => {
    try {
        const result = await WorkflowService.simulate(req.params.id, req.body.mockData || {});
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/:id/test-node - Test a single node
 * body: { nodeId, testInput? }
 */
router.post('/:id/test-node', validate(requireFields(['nodeId'])), async (req, res, next) => {
    try {
        const result = await WorkflowService.testNode(req.params.id, req.body.nodeId, req.body.testInput);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/workflows/:id/variables - Get all node outputs and shared context
 */
router.get('/:id/variables', (req, res, next) => {
    try {
        const result = WorkflowService.getVariables(req.params.id);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/workflows/:id/context - Get shared context
 */
router.get('/:id/context', (req, res, next) => {
    try {
        const workflow = WorkflowService.getById(req.params.id);
        res.json({ success: true, data: { context: workflow.context || {} } });
    }
    catch (err) {
        next(err);
    }
});
/**
 * PUT /api/workflows/:id/context - Update shared context
 * body: { context }
 */
router.put('/:id/context', (req, res, next) => {
    try {
        const { context } = req.body;
        if (!context || typeof context !== 'object') {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'context must be an object' }
            });
        }
        // Merge new context into existing context
        const existing = WorkflowService.getById(req.params.id);
        const mergedContext = { ...(existing.context || {}), ...context };
        const workflow = WorkflowService.update(req.params.id, { context: mergedContext });
        res.json({ success: true, data: { context: workflow.context } });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/workflows/:id/batch-execute - Batch execute workflow
 * body: { paramsArray: [{ input?, params? }, ...] }
 */
router.post('/:id/batch-execute', async (req, res, next) => {
    try {
        const { paramsArray } = req.body;
        if (!Array.isArray(paramsArray) || paramsArray.length === 0) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'paramsArray must be a non-empty array' }
            });
        }
        const result = await WorkflowService.batchExecute(req.params.id, paramsArray);
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/workflows/approval/respond — 处理审核决策
router.post('/approval/respond', (req, res) => {
    try {
        const { requestId, decision, comment } = req.body;
        if (!requestId || !decision) {
            return res.status(400).json({ success: false, error: 'requestId and decision are required' });
        }
        if (!['approve', 'reject'].includes(decision)) {
            return res.status(400).json({ success: false, error: 'decision must be approve or reject' });
        }
        // Try SDK mode first, then topological mode
        let handled = false;
        if (global.__sdkService) {
            handled = global.__sdkService.handleApprovalDecision(requestId, decision, comment);
        }
        if (!handled) {
            handled = WorkflowService.handleApprovalDecision(requestId, decision, comment);
        }
        res.json({ success: true, data: { handled } });
    }
    catch (err) {
        logger.error('Approval decision error:', err);
        res.status(500).json({ success: false, error: '审批处理失败' });
    }
});
module.exports = router;
//# sourceMappingURL=workflows.js.map