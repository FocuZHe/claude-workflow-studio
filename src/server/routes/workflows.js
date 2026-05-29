const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const config = require('../config');
const WorkflowService = require('../services/WorkflowService');
const WorkflowModel = require('../models/Workflow');
const FileService = require('../services/FileService');
const WorkspaceStateService = require('../services/WorkspaceStateService');
const SnapshotService = require('../services/SnapshotService');
const { AppError } = require('../middleware/errorHandler');
const { requireFields, validateString, validateEnum, validatePagination, validate } = require('../middleware/validation');
const logger = require('../utils/logger');

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
        ? allWorkflows.filter(wf => wf.workspaceId === currentWsId)
        : allWorkflows;
      WorkspaceStateService.saveState(workspaceRoot, 'workflows', wsWorkflows);
    }
  } catch (e) {
    console.error('[saveWorkspaceState] Error:', e.message);
  }
}

/**
 * POST /api/workflows - Create workflow
 */
router.post('/',
  validate(
    requireFields(['name']),
    validateString('name', 1, 100),
    validateString('description', 0, 1000)
  ),
  (req, res, next) => {
    try {
      const workflow = WorkflowService.create(req.body);
      saveWorkspaceState();
      res.status(201).json({ success: true, data: workflow });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/workflows - List workflows (supports high limit for full listing)
 */
router.get('/',
  (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const { status } = req.query;
      const result = WorkflowService.list({ status, page, limit });
      res.json({
        success: true,
        data: { items: result.items, total: result.total, page: result.page, limit: result.limit }
      });
    } catch (err) {
      next(err);
    }
  }
);

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
      } catch (e) {
        failed.push(id);
      }
    }
    saveWorkspaceState();
    res.json({ success: true, data: { deleted: deleted.length, failed } });
  } catch (err) {
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
      if (!wf) { failed.push({ id: wfId, error: 'not found' }); continue; }

      for (const targetWsId of targetWorkspaceIds) {
        if (wf.workspaceId === targetWsId) {
          skipped.push({ id: wfId, name: wf.name, workspaceId: targetWsId, reason: '目标工作区与源工作区相同' });
          continue;
        }

        const targetWs = activeWorkspaces.find(ws => ws.id === targetWsId);
        if (!targetWs) { failed.push({ id: wfId, workspaceId: targetWsId, error: 'target workspace not active' }); continue; }

        // Create a clean clone (no execution memory, no "副本" suffix)
        const { generateId } = require('../utils/id');
        const nodeIdMap = new Map();
        const clone = {
          ...wf,
          id: generateId(),
          workspaceId: targetWsId,
          status: 'draft',
          executionStatus: 'idle',
          executionLog: [],
          currentRunId: null,
          context: {},
          nodes: (wf.nodes || []).map(n => {
            const newId = generateId();
            nodeIdMap.set(n.id, newId);
            return { ...n, id: newId, status: 'pending', output: null, startedAt: null, completedAt: null, logs: [] };
          }),
          edges: (wf.edges || []).map(e => ({
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
        } else {
          const wfPath = path.join(targetWs.path, 'WORKFLOWS', 'workflows.json');
          let existing = [];
          if (fs.existsSync(wfPath)) {
            try { existing = JSON.parse(fs.readFileSync(wfPath, 'utf-8')); } catch (_) { existing = []; }
          }
          existing.push(clone);
          const dir = path.dirname(wfPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(wfPath, JSON.stringify(existing, null, 2), 'utf-8');
          cloned.push({ sourceId: wfId, sourceName: wf.name, targetWorkspaceId: targetWsId, clonedId: clone.id, clonedName: clone.name });
        }
      }
    }

    saveWorkspaceState();
    res.json({ success: true, data: { cloned, skipped, failed } });
  } catch (err) { next(err); }
});
router.get('/list-for-selection', (req, res, next) => {
  try {
    const result = WorkflowModel.findAll({ limit: 99999 });
    const workflows = (result.items || result).map(w => ({
      id: w.id,
      name: w.name,
      description: w.description,
      nodeCount: (w.nodes || []).length
    }));
    res.json({ success: true, data: workflows });
  } catch (err) { next(err); }
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
      const completed = logs.filter(l => l.status === 'completed').length;
      const failed = logs.filter(l => l.status === 'failed').length;
      totalExecutions += logs.length;
      completedExecutions += completed;
      failedExecutions += failed;

      let wfDuration = 0;
      for (const log of logs) {
        if (log.startedAt && log.completedAt) {
          wfDuration += new Date(log.completedAt) - new Date(log.startedAt);
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
  } catch (err) { next(err); }
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
      if (!workflowId || !runId) continue;
      if (WorkflowModel.removeExecutionLog(workflowId, runId)) {
        deleted++;
      }
    }
    saveWorkspaceState();
    res.json({ success: true, data: { deleted } });
  } catch (err) { next(err); }
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
      } catch (e) {
        results.push({ id, success: false, error: e.message });
      }
    }
    res.json({ success: true, data: results });
  } catch (err) { next(err); }
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
      if (wf) workflows.push(wf);
    }

    if (format === 'diagram') {
      // Export as ASCII diagram text
      const diagrams = workflows.map(wf => workflowToDiagram(wf));
      res.json({ success: true, data: { diagrams, exportedAt: new Date().toISOString() } });
    } else {
      res.json({ success: true, data: { workflows, exportedAt: new Date().toISOString() } });
    }
  } catch (err) { next(err); }
});

/**
 * Convert workflow to ASCII diagram format
 */
function workflowToDiagram(workflow) {
  const nodes = workflow.nodes || [];
  const edges = workflow.edges || [];

  // Build adjacency for output labels
  const edgeMap = {};
  edges.forEach(e => {
    if (!edgeMap[e.source]) edgeMap[e.source] = [];
    edgeMap[e.source].push(e.target);
  });

  // Sort nodes by topological order (using edges)
  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.id] = n; });

  // Find start node, then follow edges
  const ordered = [];
  const visited = new Set();
  const startNode = nodes.find(n => n.type === 'start') || nodes[0];

  function traverse(nodeId) {
    if (!nodeId || visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodeMap[nodeId];
    if (node) ordered.push(node);
    const targets = edgeMap[nodeId] || [];
    targets.forEach(tid => traverse(tid));
  }
  if (startNode) traverse(startNode.id);
  // Add any unvisited nodes
  nodes.forEach(n => { if (!visited.has(n.id)) ordered.push(n); });

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
    } else if (node.type === 'end') {
      lines.push('');
      lines.push(...makeBox(label || '结束', ''));
    } else {
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
      } else {
        try {
          const WorkspaceManager = require('../services/WorkspaceManager');
          const active = WorkspaceManager.getActive();
          const currentWorkspaceRoot = FileService.runtimeWorkspaceRoot;
          const currentWs = active.find(ws => ws.path === currentWorkspaceRoot);
          if (currentWs) workspaceId = currentWs.id;
        } catch (e) { /* fallback to null */ }
      }
      const newWf = WorkflowModel.create({ ...wf, id: undefined, isGlobal: !!isGlobal, workspaceId });
      imported.push(newWf);
    }
    saveWorkspaceState();
    res.json({ success: true, data: imported });
  } catch (err) { next(err); }
});

// ---- Import/Export .md (Claude Code Workflows) ----

/**
 * POST /api/workflows/import-md - Import a Claude Code .md workflow
 * body: { content: string, name?: string, workspaceId?: string }
 */
router.post('/import-md', (req, res, next) => {
  try {
    const { content, name, workspaceId } = req.body;
    if (!content) {
      throw new AppError('VALIDATION_ERROR', 'content is required', 400);
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
        const currentWs = active.find(ws => ws.path === currentWorkspaceRoot);
        if (currentWs) wsId = currentWs.id;
      } catch (e) { /* fallback to null */ }
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
  } catch (err) {
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
          duration: log.startedAt && log.completedAt ? Math.round((new Date(log.completedAt) - new Date(log.startedAt)) / 1000) : null
        });
      }
    }

    events.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const start = (page - 1) * limit;

    res.json({ success: true, data: { items: events.slice(start, start + limit), total: events.length, page, limit } });
  } catch (err) { next(err); }
});

/**
 * POST /api/workflows/create-from-text - Create workflow from natural language via AI
 */
router.post('/create-from-text', async (req, res, next) => {
  try {
    const { description, isGlobal } = req.body;
    if (!description) throw new AppError('VALIDATION_ERROR', 'description is required', 400);

    // Determine workspaceId for non-global workflows
    let workspaceId = null;
    if (!isGlobal) {
      try {
        const WorkspaceManager = require('../services/WorkspaceManager');
        const active = WorkspaceManager.getActive();
        const currentWorkspaceRoot = FileService.runtimeWorkspaceRoot;
        const currentWs = active.find(ws => ws.path === currentWorkspaceRoot);
        if (currentWs) workspaceId = currentWs.id;
      } catch (e) { /* fallback to null */ }
    }

    // Try AI-based creation first, fallback to diagram parser for ASCII art
    let workflowData;
    if (/[┌└│├┤┬┴▶▼─]/.test(description)) {
      // ASCII art diagram — deterministic parsing
      workflowData = parseDiagram(description);
    } else {
      // Natural language — use Claude Haiku to generate structured JSON
      workflowData = await generateWorkflowByAI(description);
    }

    // Apply isGlobal and workspaceId
    workflowData.isGlobal = !!isGlobal;
    workflowData.workspaceId = isGlobal ? null : workspaceId;

    const created = WorkflowModel.create(workflowData);
    saveWorkspaceState();
    res.status(201).json({ success: true, data: created });
  } catch (err) { next(err); }
});

/**
 * Call Claude Haiku to generate workflow JSON from natural language description
 */
async function generateWorkflowByAI(description) {
  const CHAT_WORKSPACE = path.join(config.data.dir, 'chat-workspace');
  if (!fs.existsSync(CHAT_WORKSPACE)) {
    fs.mkdirSync(CHAT_WORKSPACE, { recursive: true });
  }

  // Write system prompt to a temp file to avoid shell escaping issues on Windows
  const systemPromptPath = path.join(CHAT_WORKSPACE, '_wf_ai_system_prompt.md');
  // Show globally installed Skills for AI to reference
  let skillsHint = '';
  try {
    const SkillService = require('../services/SkillService');
    const installedSkills = SkillService.getInstalled();
    if (installedSkills.length > 0) {
      const tooMany = installedSkills.length > 50;
      const skillLines = tooMany
        ? '过多已安装技能（' + installedSkills.length + '个），仅列出名称：\n' + installedSkills.map(s => s.name).join('、')
        : installedSkills.map(s => `${s.name}（${(s.description || '').substring(0, 30)}）`).join('\n');
      skillsHint = `\n\n已安装Skills：\n${skillLines}\n\n在agent节点的skillNames数组中填入匹配的Skill名称。`;
    }
  } catch (_) {}

  // Show existing Agents for potential binding
  let agentHint = '';
  try {
    const AgentModel = require('../models/Agent');
    const all = AgentModel.findAll?.({ limit: 100 }) || {};
    const agents = Array.isArray(all.items) ? all.items : (all.data || []);
    if (agents.length > 0) {
      const lines = agents.map(a => `- "${a.name}" (id: ${a.id}, role: ${a.role}${a.skillNames?.length > 0 ? ', Skills: ' + a.skillNames.join(', ') : ''})`).join('\n');
      agentHint = `\n\n已有Agent（可绑定）：\n${lines}\n\n如果节点任务与已有Agent匹配，设置agentId绑定它。`;
    }
  } catch (_) {}

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
    { "id": "e1", "source": "节点id", "target": "节点id" }
  ]
}

节点类型说明：
- "start": 开始节点（必须有，1个）— 工作流入口，用户输入会在任务创建时传入，不需要额外的input节点
- "end": 结束节点（必须有，1个）— 工作流出口，汇总直接上游节点的输出
- "agent": Agent节点 — 执行具体任务的AI节点，必须写详细的systemPrompt和选择合适的model
- "approval": 审批节点 — 在工作流中途需要人工审核确认时使用（如审核报告质量、确认方案选择）
- "parallel": 并行节点 — 同时执行多个后续任务
- "merge": 合并节点 — 合并多个并行节点的输出（parallel后必须有merge）
- "subworkflow": 子工作流节点 — 调用另一个已存在的工作流作为子流程，需指定subWorkflowId

重要：不要在开头添加input节点！用户输入在创建任务时已经传入start节点。只在工作流中途确实需要人工干预时才使用approval节点。

模型选择规则（agent节点的config.model字段）：
- "opus": 最强模型 — 用于复杂分析、架构设计、需要深度推理的任务
- "sonnet": 平衡模型 — 用于常规开发、代码编写、文档整理等大多数任务（默认）
- "haiku": 快速模型 — 用于简单分类、格式转换、快速检索等轻量任务

选择原则：
- 需要深度思考和创造性推理 → opus
- 常规开发和执行任务 → sonnet
- 简单重复或速度优先的任务 → haiku

设计要求：
1. 优先匹配已有Agent：如果某个节点的任务与已有Agent的角色和Skills匹配，设置agentId绑定它（无需写systemPrompt）；否则设agentId为空，在config.systemPrompt中内联写完整的任务指令
2. 每个agent节点必须根据任务复杂度选择合适的model
3. 不要在开头添加input节点（用户输入由任务创建时传入）
4. 只在工作流中途确实需要人工干预时才使用approval节点（如审核关键输出、确认重要决策）
5. 使用parallel时，后续必须有对应的merge节点合并结果
6. 节点命名要准确描述其职责（如"代码审查"而非"处理"）
7. 节点position要合理分布，y轴间距约200，start节点y=60，后续依次递增
8. edges要正确反映节点间的逻辑关系
9. 整个工作流应该是一条完整的、有意义的执行链路

只输出JSON，不要有任何额外文字或解释。`;
  fs.writeFileSync(systemPromptPath, systemPromptContent, 'utf-8');

  // Write user description to a temp file as well (for safety with long Chinese text)
  const userPromptPath = path.join(CHAT_WORKSPACE, '_wf_ai_user_prompt.txt');
  fs.writeFileSync(userPromptPath, description, 'utf-8');

  return new Promise((resolve, reject) => {
    // Use --system-prompt with file content approach: pass via stdin with system prompt merged
    // This avoids shell escaping issues on Windows with long Chinese text
    const fullPrompt = `${systemPromptContent}\n\n---\n用户描述：\n${description}`;

    const args = [
      '--print',
      '--model', 'haiku',
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ];

    let output = '';
    let errorOutput = '';

    const proc = spawn('claude', args, {
      cwd: CHAT_WORKSPACE,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      windowsHide: true,
      creationFlags: 0x08000000,
    });

    // Pass both system prompt and user description via stdin
    proc.stdin.write(fullPrompt);
    proc.stdin.end();

    proc.stdin.on('error', (err) => {
      logger.warn('AI workflow stdin pipe error', { error: err.message });
    });

    let stdoutBuffer = '';

    proc.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      const parts = stdoutBuffer.split('\n');
      stdoutBuffer = parts.pop() || '';
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block.type === 'text' && block.text) output += block.text;
            }
          } else if (msg.type === 'result' && msg.result) {
            if (!output) output = msg.result;
          }
        } catch {
          // Non-JSON line — could be plain text output
          output += trimmed + '\n';
        }
      }
    });

    proc.stderr.on('data', (data) => { errorOutput += data.toString(); });

    proc.on('close', (code) => {
      // Clean up temp files
      try { fs.unlinkSync(systemPromptPath); } catch {}
      try { fs.unlinkSync(userPromptPath); } catch {}

      if (stdoutBuffer.trim()) {
        try {
          const json = JSON.parse(stdoutBuffer);
          if (json.type === 'result' && json.result && !output) output = json.result;
        } catch { output += stdoutBuffer; }
      }

      if (code !== 0 && !output) {
        logger.error('Claude Haiku workflow generation failed', { code, stderr: errorOutput.substring(0, 500) });
        reject(new AppError('AI_ERROR', `AI 工作流生成失败。请检查 Claude CLI 是否可用且已配置 Haiku 模型 (code ${code}): ${errorOutput.substring(0, 200)}`, 500));
        return;
      }

      // Parse JSON from AI response
      try {
        // Extract JSON from the response (might be wrapped in markdown code block)
        let jsonStr = output.trim();
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

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
        if (!parsed.nodes.some(n => n.type === 'start')) {
          parsed.nodes.unshift({
            id: 'n_start', label: '开始', type: 'start',
            position: { x: 80, y: 60 },
            config: {}, defaultPrompt: '', requiresInput: false
          });
        }
        if (!parsed.nodes.some(n => n.type === 'end')) {
          parsed.nodes.push({
            id: 'n_end', label: '结束', type: 'end',
            position: { x: 80, y: 60 + parsed.nodes.length * 200 },
            config: {}, defaultPrompt: '', requiresInput: false
          });
        }

        // Ensure edges connect nodes properly (build sequential chain if edges are missing)
        if (!parsed.edges || !Array.isArray(parsed.edges) || parsed.edges.length === 0) {
          const orderedNodes = parsed.nodes.filter(n => n.type !== 'start' && n.type !== 'end');
          const allNodes = parsed.nodes;
          parsed.edges = [];
          let prevId = allNodes.find(n => n.type === 'start')?.id || allNodes[0]?.id;
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
          // Ensure required fields
          n.config = n.config || {};
          n.defaultPrompt = n.defaultPrompt || '';
          n.requiresInput = n.requiresInput || false;
        });

        logger.info('AI workflow generation successful', { name: parsed.name, nodeCount: parsed.nodes.length });
        resolve(parsed);
      } catch (parseErr) {
        logger.error('AI workflow JSON parse failed', { error: parseErr.message, rawOutput: output.substring(0, 500) });
        // Try to extract at least some useful data from the AI response
        // If even that fails, throw an error — don't silently fall back to keyword parser
        reject(new AppError('AI_ERROR', `AI 生成了无效的工作流格式，请尝试更简洁的描述或稍后再试。原始错误: ${parseErr.message}`, 500));
      }
    });

    proc.on('error', (err) => {
      // Clean up temp files
      try { fs.unlinkSync(systemPromptPath); } catch {}
      try { fs.unlinkSync(userPromptPath); } catch {}
      reject(new AppError('AI_ERROR', `无法启动 Claude CLI: ${err.message}。请确保 Claude CLI 已安装并可用。`, 500));
    });

    // Timeout after 90 seconds
    const timeout = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      // Clean up temp files
      try { fs.unlinkSync(systemPromptPath); } catch {}
      try { fs.unlinkSync(userPromptPath); } catch {}
      reject(new AppError('AI_ERROR', 'AI 工作流生成超时（90秒），请尝试更简洁的描述或稍后再试。', 504));
    }, 90 * 1000);

    proc.on('close', () => clearTimeout(timeout));
  });
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
      if (!firstBoxMatch) { i++; continue; }

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
          if (bottom) boxContent.push(bottom);
          break;
        }
        // Extract content from the box's column range
        const segment = row.substring(boxStart, boxStart + boxWidth);
        const inner = segment.replace(/[│├┤]/g, '').trim();
        if (inner) boxContent.push(inner);
        j++;
      }

      if (boxContent.length > 0) {
        // Clean up: remove ──▶ artifacts, stray ─, and extra spaces
        const cleanContent = boxContent.map(s =>
          s.replace(/─+▶.*/g, '').replace(/[─]/g, '').replace(/\s+/g, ' ').trim()
        ).filter(Boolean);
        const label = cleanContent[0] || `节点${boxNodes.length + 1}`;
        const desc = cleanContent.slice(1).join(' ');
        boxNodes.push({ label, desc });
      }

      // Skip to after the bottom
      let k = i + 1;
      while (k < lines.length && !/└─+┘/.test(lines[k])) k++;
      i = k + 1;
    } else {
      i++;
    }
  }

  // 2. Extract text-only lines before boxes (like "用户输入仓库路径")
  const inputDesc = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !/[┌└│├┤┬┴▶▼─]/.test(trimmed) && !/^\s*$/.test(trimmed)) {
      // Pure text line — likely an input description
      if (trimmed.length < 50) inputDesc.push(trimmed);
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
  const nameSource = boxNodes[0]?.label || inputDesc[0] || description.substring(0, 30);

  return {
    name: nameSource.substring(0, 30),
    description: description.substring(0, 200),
    nodes,
    edges
  };
}

/**
 * Parse simple natural language text (original behavior)
 */
function parseSimpleText(description) {
  const nodes = [
    { id: 'n1', label: '开始', type: 'start', agentId: '', position: { x: 60, y: 200 }, config: {}, defaultPrompt: '', requiresInput: true }
  ];
  const edges = [];
  let nodeId = 2;
  let x = 250;

  const keywords = {
    '搜集|收集|搜索|查找': { label: '搜集信息', type: 'agent' },
    '分析|研究|检查': { label: '分析处理', type: 'agent' },
    '整理|归纳|总结': { label: '整理归纳', type: 'agent' },
    '生成|创建|编写|写': { label: '生成内容', type: 'agent' },
    '翻译|转换': { label: '翻译转换', type: 'agent' },
    '审查|校对|检查': { label: '审查校对', type: 'agent' },
    '测试|验证': { label: '测试验证', type: 'agent' },
    '报告|文档|输出': { label: '生成报告', type: 'agent' }
  };

  const steps = description.split(/[，,；;。.然后接着再]/).filter(Boolean);

  for (const step of steps) {
    let matched = false;
    for (const [pattern, config] of Object.entries(keywords)) {
      if (new RegExp(pattern).test(step)) {
        nodes.push({
          id: `n${nodeId}`,
          label: config.label,
          type: config.type,
          agentId: '',
          position: { x, y: 200 },
          config: { systemPrompt: step.trim() },
          defaultPrompt: '',
          requiresInput: true
        });
        if (nodeId > 2) {
          edges.push({ id: `e${nodeId - 1}`, source: `n${nodeId - 1}`, target: `n${nodeId}` });
        } else {
          edges.push({ id: 'e1', source: 'n1', target: `n${nodeId}` });
        }
        nodeId++;
        x += 190;
        matched = true;
        break;
      }
    }
    if (!matched && step.trim()) {
      nodes.push({
        id: `n${nodeId}`,
        label: step.trim().substring(0, 10),
        type: 'agent',
        agentId: '',
        position: { x, y: 200 },
        config: { systemPrompt: step.trim() },
        defaultPrompt: '',
        requiresInput: true
      });
      if (nodeId > 2) {
        edges.push({ id: `e${nodeId - 1}`, source: `n${nodeId - 1}`, target: `n${nodeId}` });
      } else {
        edges.push({ id: 'e1', source: 'n1', target: `n${nodeId}` });
      }
      nodeId++;
      x += 190;
    }
  }

  nodes.push({
    id: `n${nodeId}`,
    label: '结束',
    type: 'end',
    agentId: '',
    position: { x, y: 200 },
    config: {},
    defaultPrompt: '',
    requiresInput: false
  });
  edges.push({ id: `e${nodeId}`, source: `n${nodeId - 1}`, target: `n${nodeId}` });

  return {
    name: description.substring(0, 30),
    description,
    nodes,
    edges
  };
}

// ---- Snapshot routes (must be before /:id routes) ----

/**
 * POST /api/workflows/:id/snapshots - Create a workflow snapshot
 */
router.post('/:id/snapshots', (req, res, next) => {
  try {
    const snapshot = SnapshotService.save(req.params.id, req.body.name);
    res.status(201).json({ success: true, data: snapshot });
  } catch (err) { next(err); }
});

/**
 * GET /api/workflows/:id/snapshots - List workflow snapshots
 */
router.get('/:id/snapshots', (req, res, next) => {
  try {
    res.json({ success: true, data: SnapshotService.list(req.params.id) });
  } catch (err) { next(err); }
});

/**
 * POST /api/workflows/:id/snapshots/:snapshotId/restore - Restore workflow from snapshot
 */
router.post('/:id/snapshots/:snapshotId/restore', (req, res, next) => {
  try {
    const result = SnapshotService.restore(req.params.id, req.params.snapshotId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/workflows/:id/snapshots/:snapshotId - Delete a snapshot
 */
router.delete('/:id/snapshots/:snapshotId', (req, res, next) => {
  try {
    SnapshotService.delete(req.params.id, req.params.snapshotId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

/**
 * POST /api/workflows/:id/resume-from-checkpoint - Resume workflow from checkpoint
 * body: { runId? } (optional, defaults to latest checkpoint)
 */
router.post('/:id/resume-from-checkpoint', async (req, res, next) => {
  try {
    const { id } = req.params;
    const workflow = WorkflowModel.findById(id);
    if (!workflow) throw new AppError('NOT_FOUND', '工作流未找到', 404);

    const CheckpointService = require('../services/CheckpointService');
    const checkpoint = req.body.runId
      ? CheckpointService.loadCheckpoint(id, req.body.runId)
      : CheckpointService.getLatestCheckpoint(id);

    if (!checkpoint) throw new AppError('NOT_FOUND', '未找到检查点', 404);

    const result = await WorkflowService.resumeFromCheckpoint(id, checkpoint);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

/**
 * GET /api/workflows/:id/checkpoints - List checkpoints for a workflow
 */
router.get('/:id/checkpoints', (req, res, next) => {
  try {
    const CheckpointService = require('../services/CheckpointService');
    const checkpoints = CheckpointService.listCheckpoints(req.params.id);
    res.json({ success: true, data: checkpoints });
  } catch (err) { next(err); }
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
  } catch (err) {
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
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/workflows/:id - Update workflow
 */
router.put('/:id',
  validate(
    validateString('name', 1, 100),
    validateString('description', 0, 1000)
  ),
  (req, res, next) => {
    try {
      const workflow = WorkflowService.update(req.params.id, req.body);
      saveWorkspaceState();
      res.json({ success: true, data: workflow });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/workflows/:id/rename - Rename workflow
 * body: { name: string }
 */
router.put('/:id/rename',
  validate(requireFields(['name']), validateString('name', 1, 100)),
  (req, res, next) => {
    try {
      const { name } = req.body;
      const workflow = WorkflowModel.findById(req.params.id);
      if (!workflow) {
        throw new AppError('NOT_FOUND', `Workflow with id '${req.params.id}' not found`, 404);
      }
      const updated = WorkflowModel.update(req.params.id, { name });
      saveWorkspaceState();
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/workflows/create-in-all - Create workflow in all active workspaces
 * body: { name, description?, nodes?, edges? }
 */
router.post('/create-in-all',
  validate(requireFields(['name']), validateString('name', 1, 100)),
  (req, res, next) => {
    try {
      const workflows = WorkflowModel.createInAllWorkspaces(req.body);
      // Don't call saveWorkspaceState() here — createInAllWorkspaces already
      // calls _persist() which groups workflows by workspaceId and writes each
      // group to its correct workspace file.
      // Only return the workflow belonging to the current workspace to avoid
      // the frontend showing all workflows as duplicates.
      const currentWsId = (() => {
        try {
          const WorkspaceManager = require('../services/WorkspaceManager');
          const ws = WorkspaceManager.findByPath(FileService.runtimeWorkspaceRoot);
          return ws ? ws.id : null;
        } catch (e) { return null; }
      })();
      const currentWf = currentWsId
        ? workflows.find(wf => wf.workspaceId === currentWsId)
        : workflows[0];
      res.status(201).json({ success: true, data: currentWf || workflows[0] });
    } catch (err) {
      next(err);
    }
  }
);

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
    res.status(204).send();
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/workflows/:id/stop - Stop a running workflow
 */
router.post('/:id/stop', (req, res, next) => {
  try {
    const result = WorkflowService.stop(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
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
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/workflows/:id/step - Single-step execution
 * body: { nodeId }
 */
router.post('/:id/step',
  validate(requireFields(['nodeId'])),
  async (req, res, next) => {
    try {
      const result = await WorkflowService.step(req.params.id, req.body.nodeId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/workflows/:id/simulate - Simulate workflow with mock data
 * body: { mockData? }
 */
router.post('/:id/simulate', async (req, res, next) => {
  try {
    const result = await WorkflowService.simulate(req.params.id, req.body.mockData || {});
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/workflows/:id/test-node - Test a single node
 * body: { nodeId, testInput? }
 */
router.post('/:id/test-node',
  validate(requireFields(['nodeId'])),
  async (req, res, next) => {
    try {
      const result = await WorkflowService.testNode(req.params.id, req.body.nodeId, req.body.testInput);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/workflows/:id/variables - Get all node outputs and shared context
 */
router.get('/:id/variables', (req, res, next) => {
  try {
    const result = WorkflowService.getVariables(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
