"use strict";
/**
 * Workflow business logic service
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowService = void 0;
const path_1 = __importDefault(require("path"));
// JS 模块使用 require 导入（尚未转换为 TS）
const WorkflowModel = require('../models/Workflow');
const AgentModel = require('../models/Agent');
const TaskModel = require('../models/Task');
const FileService = require('./FileService');
const WorkspaceStateService = require('./WorkspaceStateService');
const ApiKeyService = require('./ApiKeyService');
const { AppError } = require('../middleware/errorHandler');
const { generateId } = require('../utils/id');
const SelfRepair = require('../utils/SelfRepair');
const logger = require('../utils/logger');
class WorkflowService {
    static _broadcastService = null;
    static _claudeService = null;
    static _pendingApprovals = new Map();
    static _currentRunIds = new Map(); // workflowId -> runId（防止并发覆盖）
    static _activeOrchestrators = new Map(); // workflowId -> WorkflowOrchestrator（用于停止工作流时关闭子Agent）
    /**
     * Initialize WorkflowService with dependencies
     */
    static init(broadcastService, claudeService) {
        WorkflowService._broadcastService = broadcastService;
        if (claudeService) {
            WorkflowService._claudeService = claudeService;
        }
    }
    /**
     * 修复卡在 'running' 的 executionLog 记录
     * 服务器重启后：
     * - 有 checkpoint 的工作流 → 标记为 interrupted（可恢复）
     * - 没有 checkpoint 的 → 标记为 failed
     */
    static fixStaleExecutionLogs() {
        try {
            const workflows = WorkflowModel.getAll();
            let fixedCount = 0;
            let interruptedCount = 0;
            for (const wf of workflows) {
                if (!wf.executionLog || wf.executionLog.length === 0)
                    continue;
                let changed = false;
                for (const log of wf.executionLog) {
                    if (log.status === 'running') {
                        // 检查是否有 checkpoint 可以恢复
                        let hasCheckpoint = false;
                        try {
                            const CheckpointService = require('./CheckpointService');
                            let checkpoint = CheckpointService.getLatestCheckpoint(wf.id);
                            if (!checkpoint) {
                                checkpoint = CheckpointService.getLatestCheckpoint('current');
                            }
                            hasCheckpoint = !!checkpoint;
                        }
                        catch (_) { }
                        if (hasCheckpoint) {
                            // 有 checkpoint：标记为 interrupted，用户可以手动恢复
                            log.status = 'interrupted';
                            changed = true;
                            interruptedCount++;
                        }
                        else {
                            // 没有 checkpoint：标记为 failed
                            log.status = 'failed';
                            log.completedAt = log.startedAt ? new Date(log.startedAt) : new Date();
                            changed = true;
                            fixedCount++;
                        }
                    }
                }
                if (changed) {
                    WorkflowModel.update(wf.id, { executionLog: wf.executionLog });
                }
            }
            if (fixedCount > 0 || interruptedCount > 0) {
                WorkflowModel._flush();
                logger.info(`[Recovery] 修复了 ${fixedCount} 条 failed 记录，${interruptedCount} 条 interrupted 记录`);
            }
        }
        catch (e) {
            logger.warn('[Recovery] executionLog 修复失败:', e.message);
        }
    }
    /**
     * Phase 3: 崩溃恢复 - 服务器启动时检查中断的工作流
     * 1. 检查 running 状态的工作流，标记为 interrupted
     * 2. 清理残留的 session-store 中的过期任务
     */
    static recoverInterruptedWorkflows() {
        logger.info('[Recovery] 启动崩溃恢复检查...');
        // 0. 修复卡在 'running' 的 executionLog 记录
        WorkflowService.fixStaleExecutionLogs();
        // 1. 重置卡住的节点
        WorkflowService.resetStuckNodes();
        // 2. 清理过期的 session-store
        try {
            const fs = require('fs');
            const path = require('path');
            const storePath = path.join(process.cwd(), 'data', 'session-store.json');
            if (fs.existsSync(storePath)) {
                const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
                const now = Date.now();
                let cleaned = 0;
                for (const [key, value] of Object.entries(store)) {
                    const item = value;
                    // 清理超过24小时的 running 状态任务
                    if (item.status === 'running' && item.timestamp) {
                        const elapsed = now - new Date(item.timestamp).getTime();
                        if (elapsed > 24 * 60 * 60 * 1000) {
                            item.status = 'expired';
                            cleaned++;
                        }
                    }
                }
                if (cleaned > 0) {
                    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
                    logger.info(`[Recovery] 清理了 ${cleaned} 个过期的 session 任务`);
                }
            }
        }
        catch (e) {
            logger.warn('[Recovery] Session store 清理失败:', e.message);
        }
        logger.info('[Recovery] 崩溃恢复检查完成');
    }
    /**
     * Reset nodes that were waiting for human intervention when server restarted.
     */
    static resetStuckNodes() {
        try {
            const workflows = WorkflowModel.getAll();
            let resetCount = 0;
            let interruptCount = 0;
            for (const wf of workflows) {
                let hasStuckNodes = false;
                // 检查是否有running状态的节点
                for (const node of (wf.nodes || [])) {
                    if (node.status === 'running') {
                        hasStuckNodes = true;
                        break;
                    }
                }
                // 如果有running节点或工作流状态是running/failed，检查是否有checkpoint
                if (hasStuckNodes || wf.executionStatus === 'running' || wf.executionStatus === 'failed') {
                    try {
                        const CheckpointService = require('./CheckpointService');
                        // Try both workflow-specific and 'current' checkpoints
                        let checkpoint = CheckpointService.getLatestCheckpoint(wf.id);
                        if (!checkpoint) {
                            checkpoint = CheckpointService.getLatestCheckpoint('current');
                        }
                        if (checkpoint) {
                            // Has checkpoint: mark workflow as interrupted (resumable by user)
                            WorkflowModel.update(wf.id, { executionStatus: 'interrupted', currentRunId: checkpoint.runId });
                            logger.info(`Workflow ${wf.id} marked as interrupted (has checkpoint, manual resume required)`);
                            interruptCount++;
                            continue;
                        }
                    }
                    catch (e) { /* checkpoint check is best-effort */ }
                }
                // 如果没有checkpoint，重置running状态的节点
                if (hasStuckNodes) {
                    for (const node of (wf.nodes || [])) {
                        if (node.status === 'running') {
                            WorkflowModel.updateNodeStatus(wf.id, node.id, 'pending');
                            resetCount++;
                            logger.info(`Reset stale running node ${node.id} in workflow ${wf.id}`);
                        }
                    }
                }
                // Reset workflow status if it was left as 'running' from a previous session
                if (wf.status === 'running' || wf.executionStatus === 'running') {
                    WorkflowModel.update(wf.id, { executionStatus: 'idle', status: 'draft', currentRunId: null });
                    logger.info(`Reset stale execution status for workflow ${wf.id}`);
                }
            }
            if (resetCount > 0) {
                logger.info(`Reset ${resetCount} stuck/stale nodes on server startup`);
            }
            if (interruptCount > 0) {
                logger.info(`${interruptCount} workflow(s) marked as interrupted (manual resume required via UI)`);
            }
        }
        catch (err) {
            logger.warn(`Failed to reset stuck nodes: ${err.message}`);
        }
    }
    /**
     * Create a new workflow
     */
    static create(data) {
        // Validate graph before creating
        if (data.nodes && data.nodes.length > 1) {
            const validation = WorkflowService.validateGraph(data.nodes, data.edges || []);
            if (!validation.valid) {
                throw new AppError('VALIDATION_ERROR', '无效的工作流图', 400, validation.errors);
            }
        }
        const workflow = WorkflowModel.create(data);
        logger.info(`Workflow created: ${workflow.id}`, { name: workflow.name });
        return workflow;
    }
    /**
     * List workflows
     */
    static list(filters) {
        return WorkflowModel.findAll(filters);
    }
    /**
     * Get workflow by ID
     */
    static getById(id) {
        const workflow = WorkflowModel.findById(id);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
        }
        return workflow;
    }
    /**
     * Update workflow with graph validation
     */
    static update(id, data) {
        const existing = WorkflowModel.findById(id);
        if (!existing) {
            throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
        }
        // Validate graph if nodes or edges are being updated
        if (data.nodes || data.edges) {
            const nodes = data.nodes || existing.nodes;
            const edges = data.edges || existing.edges;
            const validation = WorkflowService.validateGraph(nodes, edges);
            if (!validation.valid) {
                throw new AppError('VALIDATION_ERROR', '无效的工作流图', 400, validation.errors);
            }
            // Validate agent references
            const agentValidation = WorkflowService.validateAgentReferences(nodes);
            if (!agentValidation.valid) {
                throw new AppError('VALIDATION_ERROR', '无效的智能体引用', 400, agentValidation.errors);
            }
        }
        const workflow = WorkflowModel.update(id, data);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
        }
        logger.info(`Workflow updated: ${id}`);
        return workflow;
    }
    /**
     * Delete workflow
     */
    static delete(id) {
        const workflow = WorkflowModel.findById(id);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
        }
        if (workflow.status === 'running' && workflow.executionStatus === 'running') {
            throw new AppError('CONFLICT', '工作流正在运行中，无法删除。请先停止工作流。', 409);
        }
        // Clean up associated resources (best-effort)
        WorkflowService._cleanupWorkflowResources(id);
        WorkflowModel.delete(id);
        logger.info(`Workflow deleted: ${id}`);
        return true;
    }
    /**
     * Clean up all resources associated with a workflow (memory, checkpoints, snapshots)
     */
    static _cleanupWorkflowResources(workflowId) {
        try {
            const MemoryService = require('./MemoryService');
            MemoryService.deleteMemory(workflowId);
            MemoryService.cleanSharedPool(workflowId);
        }
        catch (e) {
            logger.warn(`Failed to delete memory for workflow ${workflowId}: ${e.message}`);
        }
        try {
            const CheckpointService = require('./CheckpointService');
            CheckpointService.deleteAllCheckpoints(workflowId);
        }
        catch (e) {
            logger.warn(`Failed to delete checkpoints for workflow ${workflowId}: ${e.message}`);
        }
        try {
            const SnapshotService = require('./SnapshotService');
            const snapshots = SnapshotService.getSnapshots(workflowId);
            if (Array.isArray(snapshots)) {
                for (const s of snapshots) {
                    try {
                        SnapshotService.delete(workflowId, s.id);
                    }
                    catch (e) { /* ignore */ }
                }
            }
        }
        catch (e) {
            logger.warn(`Failed to delete snapshots for workflow ${workflowId}: ${e.message}`);
        }
    }
    /**
     * Validate workflow graph integrity
     */
    static validateGraph(nodes, edges) {
        const errors = [];
        if (!nodes || nodes.length === 0) {
            return { valid: true, errors: [] };
        }
        // Build node ID set
        const nodeIds = new Set(nodes.map(n => n.id));
        // Check for start and end nodes
        const hasStart = nodes.some(n => n.type === 'start');
        const hasEnd = nodes.some(n => n.type === 'end');
        // Validate edges reference existing nodes
        for (const edge of edges) {
            const src = edge.source || edge.from || '';
            const tgt = edge.target || edge.to || '';
            if (!nodeIds.has(src)) {
                errors.push({ field: `edge.${edge.id}.source`, message: `Source node '${src}' does not exist` });
            }
            if (!nodeIds.has(tgt)) {
                errors.push({ field: `edge.${edge.id}.target`, message: `Target node '${tgt}' does not exist` });
            }
        }
        // Check for orphan nodes (nodes with no edges)
        if (nodes.length > 1) {
            // No edges at all but multiple nodes exist — all are disconnected
            if (edges.length === 0) {
                errors.push({ field: 'edges', message: '工作流需要至少一条连线来连接节点' });
            }
            else {
                const connectedNodes = new Set();
                for (const edge of edges) {
                    connectedNodes.add(edge.source || edge.from || '');
                    connectedNodes.add(edge.target || edge.to || '');
                }
                for (const node of nodes) {
                    if (!connectedNodes.has(node.id)) {
                        errors.push({ field: `node.${node.id}`, message: `Node '${node.label || node.id}' is disconnected` });
                    }
                }
            }
        }
        return {
            valid: errors.length === 0,
            errors,
            hasStart,
            hasEnd
        };
    }
    /**
     * Validate agent references in workflow nodes
     */
    static validateAgentReferences(nodes) {
        const errors = [];
        for (const node of nodes) {
            if (node.agentId && !AgentModel.exists(node.agentId)) {
                errors.push({
                    field: `node.${node.id}.agentId`,
                    message: `Agent '${node.agentId}' does not exist`
                });
            }
        }
        return {
            valid: errors.length === 0,
            errors
        };
    }
    /**
     * Execute workflow - always uses Master Agent mode (native Agent tool collaboration).
     * Returns immediately with runId, execution continues in background.
     */
    static execute(id, input, params, nodeInputs) {
        const workflow = WorkflowModel.findById(id);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
        }
        // 防止并发执行：检查工作流是否已在运行
        if (workflow.executionStatus === 'running') {
            throw new AppError('CONFLICT', `工作流 "${workflow.name}" 正在运行中，请等待完成后再执行`, 409);
        }
        // Validate graph has start node
        const hasStart = workflow.nodes.some((n) => n.type === 'start');
        if (!hasStart) {
            throw new AppError('VALIDATION_ERROR', '工作流必须有开始节点', 400);
        }
        // 确保 workflow 有 folderPath（优先使用工作区管理器中的路径）
        if (!workflow.folderPath) {
            try {
                const WorkspaceManager = require('./WorkspaceManager');
                const wsData = workflow.workspaceId ? WorkspaceManager.getById(workflow.workspaceId) : null;
                const workspaceRoot = wsData ? wsData.path : FileService.getWorkspaceRoot();
                if (workspaceRoot) {
                    WorkflowModel.update(id, { folderPath: workspaceRoot });
                    logger.info(`Workflow ${id} folderPath set to workspace root: ${workspaceRoot}`);
                }
            }
            catch (e) {
                // 回退到原有逻辑
                const workspaceRoot = FileService.getWorkspaceRoot();
                if (workspaceRoot) {
                    WorkflowModel.update(id, { folderPath: workspaceRoot });
                    logger.info(`Workflow ${id} folderPath set to workspace root: ${workspaceRoot}`);
                }
            }
        }
        const runId = generateId();
        const executionEntry = {
            runId,
            startedAt: new Date(),
            completedAt: null,
            status: 'running',
            nodeResults: workflow.nodes.map((n) => ({
                nodeId: n.id,
                status: 'pending',
                output: null,
                startedAt: null,
                completedAt: null
            }))
        };
        WorkflowModel.addExecutionLog(id, executionEntry);
        // Merge params into workflow context and store nodeInputs
        // Initialize _visitedWorkflows set for circular subworkflow detection
        const existingVisited = workflow.context?._visitedWorkflows || [];
        const visitedSet = new Set(existingVisited);
        visitedSet.add(id);
        const context = { ...(workflow.context || {}), ...(params || {}), __nodeInputs: nodeInputs || {}, _visitedWorkflows: [...visitedSet] };
        WorkflowModel.update(id, {
            status: 'running',
            executionStatus: 'running',
            currentRunId: runId,
            context
        });
        // Reset all node statuses to 'pending' for fresh execution
        for (const node of workflow.nodes) {
            WorkflowModel.updateNodeStatus(id, node.id, 'pending');
        }
        logger.info(`Workflow execution started: ${id}`, { runId });
        // Broadcast workflow status update
        WorkflowService._broadcastStatusUpdate(id, 'running', runId);
        // Always use Master Agent mode
        logger.info(`Workflow ${id}: using MasterAgent mode (native Agent tool collaboration)`);
        WorkflowService._executeMasterAgentWithRetry(id, runId, input, workflow, 1).catch((err) => {
            logger.error(`MasterAgent execution error: ${id}`, { runId, error: err.message, stack: err.stack });
            try {
                WorkflowService._failWorkflow(id, runId, err.message);
            }
            catch (failErr) {
                // Last resort: directly update workflow status to prevent stuck "running" state
                logger.error(`Failed to mark workflow as failed: ${id}`, { error: failErr.message });
                try {
                    WorkflowModel.update(id, { status: 'failed', executionStatus: 'failed', error: err.message });
                }
                catch (_) {
                    logger.error(`CRITICAL: Cannot update workflow status for ${id}.workflow may be stuck.`);
                }
            }
        });
        return { runId, status: 'running' };
    }
    /**
     * 带重试的主Agent执行 - 自动处理429等可重试错误
     */
    static async _executeMasterAgentWithRetry(workflowId, runId, input, workflow, maxRetries = 3) {
        let lastError = null;
        let currentWorkflow = workflow;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                logger.info(`Workflow ${workflowId} attempt ${attempt}/${maxRetries}`);
                // 使用 WorkflowOrchestrator（双轨闭环架构）执行工作流
                await WorkflowService._executeWithOrchestrator(workflowId, runId, input, currentWorkflow);
                logger.info(`Workflow ${workflowId} attempt ${attempt} succeeded`);
                return; // 成功，直接返回
            }
            catch (err) {
                lastError = err;
                const errorInfo = WorkflowService._parseError(err);
                // 检查是否可重试
                if (!errorInfo.retryable || attempt >= maxRetries) {
                    // 构建用户友好的错误信息
                    let userMessage = errorInfo.message;
                    if (errorInfo.type === 'RATE_LIMITED') {
                        userMessage = `API 请求频率超限（429错误）。已重试 ${attempt} 次均失败。\n\n建议操作：\n1. 等待几分钟后手动重新执行工作流\n2. 减少同时运行的工作流数量\n3. 检查 API 配额是否充足`;
                    }
                    else if (errorInfo.type === 'SERVICE_OVERLOADED') {
                        userMessage = `API 服务暂时过载（529错误）。已重试 ${attempt} 次均失败。\n\n建议操作：\n1. 等待几分钟后手动重新执行工作流\n2. 稍后再试`;
                    }
                    // 创建带用户友好信息的错误
                    const enhancedErr = new Error(userMessage);
                    enhancedErr.errorType = errorInfo.type;
                    enhancedErr.retryable = false;
                    enhancedErr.originalError = err;
                    throw enhancedErr;
                }
                // 计算退避时间：指数退避 + 随机抖动
                const baseDelay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
                const jitter = Math.random() * 1000; // 0-1s 随机抖动
                const delay = baseDelay + jitter;
                logger.warn(`Workflow ${workflowId} attempt ${attempt}/${maxRetries} failed: ${errorInfo.message}. Retrying in ${Math.round(delay / 1000)}s...`);
                // 保存检查点以便恢复
                try {
                    WorkflowService._saveCheckpoint(workflowId, currentWorkflow.folderPath || process.cwd(), currentWorkflow.nodes, `重试中: ${errorInfo.message}`);
                }
                catch (_) { /* ignore */ }
                // 等待后重试
                await new Promise(resolve => setTimeout(resolve, delay));
                // 重新加载工作流状态（可能已被检查点更新）
                const freshWorkflow = WorkflowModel.findById(workflowId);
                if (freshWorkflow) {
                    currentWorkflow = freshWorkflow;
                }
            }
        }
        throw lastError;
    }
    /**
     * 解析错误信息，判断是否可重试
     */
    static _parseError(err) {
        const s = (err.message || '').toLowerCase();
        if (s.includes('429') || s.includes('rate') || s.includes('too many')) {
            return { type: 'RATE_LIMITED', message: 'API 请求频率超限', retryable: true };
        }
        if (s.includes('529') || s.includes('overloaded')) {
            return { type: 'SERVICE_OVERLOADED', message: 'API 服务暂时过载', retryable: true };
        }
        if (s.includes('timeout') || s.includes('timed out')) {
            return { type: 'TIMEOUT', message: '执行超时', retryable: true };
        }
        if (s.includes('network') || s.includes('econnrefused') || s.includes('econnreset')) {
            return { type: 'NETWORK_ERROR', message: '网络连接错误', retryable: true };
        }
        return { type: 'EXECUTION_ERROR', message: err.message || '执行失败', retryable: false };
    }
    /**
     * 使用 WorkflowOrchestrator（双轨闭环架构）执行工作流
     *
     * 核心优势：
     * - 主Agent使用原生 Anthropic API，仅持有 call_sub_agent 工具
     * - 子Agent使用 Claude Agent SDK，拥有完整工具权限
     * - TS层拦截 call_sub_agent，物理执行子Agent
     * - 主Agent无法"假装干活"，必须通过 call_sub_agent 调度
     */
    static async _executeWithOrchestrator(workflowId, runId, input, workflow) {
        const workspaceRoot = workflow.folderPath || FileService.getWorkspaceRoot() || process.cwd();
        // 创建状态存储适配器（支持 Session 恢复）
        const stateStore = {
            save: async (key, value) => {
                // 保存到工作流上下文
                const context = workflow.context || {};
                context[key] = value;
                WorkflowModel.update(workflowId, { context });
                // 同时持久化到文件（用于崩溃恢复）
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const storePath = path.join(process.cwd(), 'data', 'session-store.json');
                    let store = {};
                    try {
                        store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
                    }
                    catch (_) { }
                    store[key] = value;
                    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
                }
                catch (_) { }
            },
            get: async (key) => {
                // 优先从工作流上下文获取
                if (workflow.context?.[key])
                    return workflow.context[key];
                // 回退到文件存储
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const storePath = path.join(process.cwd(), 'data', 'session-store.json');
                    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
                    return store[key] || null;
                }
                catch (_) {
                    return null;
                }
            },
            query: async (filter) => {
                // 查询所有运行中的任务
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const storePath = path.join(process.cwd(), 'data', 'session-store.json');
                    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
                    return Object.values(store).filter((item) => item.status === filter.status);
                }
                catch (_) {
                    return [];
                }
            }
        };
        // 创建 WorkflowOrchestrator（内部自动从 ApiKeyService 获取 API Key）
        const { WorkflowOrchestrator } = require('./WorkflowOrchestrator');
        const broadcastService = WorkflowService._broadcastService;
        const orchestrator = new WorkflowOrchestrator(workspaceRoot, stateStore, logger, broadcastService);
        // 保存到全局 Map，以便在工作流停止时能够关闭子Agent
        WorkflowService._activeOrchestrators.set(workflowId, orchestrator);
        logger.info(`[Orchestrator] 保存活跃编排器: ${workflowId}`);
        // 更新工作流状态
        WorkflowModel.update(workflowId, { executionStatus: 'running' });
        WorkflowService._broadcastStatusUpdate(workflowId, 'running', runId);
        try {
            // 启动主Agent指挥官
            logger.info(`[Orchestrator] 启动主Agent指挥官: ${workflowId}`);
            const result = await orchestrator.startMasterCommander(typeof input === 'string' ? input : JSON.stringify(input || '执行工作流'), workflow, runId);
            logger.info(`[Orchestrator] 主Agent执行结果: success=${result.success}, error=${result.error || 'none'}`);
            if (result.success) {
                // 标记所有未完成的节点为完成
                const freshWorkflow = WorkflowModel.findById(workflowId);
                const nodes = freshWorkflow ? freshWorkflow.nodes : workflow.nodes;
                for (const node of nodes) {
                    if (node.type !== 'start' && node.type !== 'end' && node.status !== 'completed') {
                        logger.info(`[Orchestrator] 标记节点完成: ${node.id}`);
                        WorkflowModel.updateNodeStatus(workflowId, node.id, 'completed', result.output);
                        WorkflowService._broadcastNodeUpdate(workflowId, runId, node.id);
                    }
                }
                // 标记 end 节点完成
                const endNode = workflow.nodes.find(n => n.type === 'end');
                if (endNode) {
                    WorkflowModel.updateNodeStatus(workflowId, endNode.id, 'completed', result.output);
                    WorkflowService._broadcastNodeUpdate(workflowId, runId, endNode.id);
                }
                // 保存记忆（仅在 memoryEnabled=true 时）
                if (workflow.memoryEnabled === true) {
                    try {
                        const MemoryService = require('./MemoryService');
                        const memSummary = MemoryService.extractSummary(result.output);
                        const agentMemories = MemoryService.extractAgentMemory(result.output);
                        let memoryEntry = memSummary;
                        if (agentMemories.length > 0) {
                            memoryEntry += '\n\nAgent 主动记忆:\n' + agentMemories.map((m) => `- ${m}`).join('\n');
                        }
                        const tag = (input || '').substring(0, 50).replace(/\n/g, ' ').trim();
                        MemoryService.appendMemoryWithTag(workflowId, memoryEntry, tag);
                        logger.info(`[Orchestrator] 记忆已保存: ${workflowId}`);
                    }
                    catch (e) {
                        logger.warn(`[Orchestrator] 保存记忆失败: ${e.message}`);
                    }
                }
                // 更新 executionLog 中的状态
                const completedWorkflow = WorkflowModel.findById(workflowId);
                if (completedWorkflow && completedWorkflow.executionLog) {
                    const logEntry = completedWorkflow.executionLog.find((l) => l.runId === runId);
                    if (logEntry) {
                        logEntry.status = 'completed';
                        logEntry.completedAt = new Date().toISOString();
                        WorkflowModel.update(workflowId, { executionLog: completedWorkflow.executionLog });
                        // 强制同步保存，确保数据不丢失
                        WorkflowModel._flush();
                    }
                }
                // 标记工作流完成
                WorkflowModel.update(workflowId, { executionStatus: 'completed' });
                WorkflowService._broadcastStatusUpdate(workflowId, 'completed', runId);
                logger.info(`[Orchestrator] 工作流完成: ${workflowId}`);
            }
            else {
                throw new Error(result.error || '工作流执行失败');
            }
        }
        catch (err) {
            logger.error(`[Orchestrator] 工作流失败: ${workflowId}`, { error: err.message });
            await orchestrator.shutdownAll();
            throw err;
        }
        finally {
            // 清理全局 Map
            WorkflowService._activeOrchestrators.delete(workflowId);
            logger.info(`[Orchestrator] 清理活跃编排器: ${workflowId}`);
        }
    }
    /**
     * 清理子 Agent 启动的服务器进程（端口 8000-8999）
     * 防止端口占用堆积
     *
     * 改进：
     * 1. 在工作流完成/失败时调用
     * 2. 在服务器启动时调用（清理遗留进程）
     * 3. 只清理当前工作区目录下的 node 进程，避免误杀
     */
    static async _cleanupSubagentProcesses(workspaceRoot) {
        try {
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);
            // 查找占用 8000-8999 端口的进程
            const platform = process.platform;
            const pidsToKill = [];
            if (platform === 'win32') {
                try {
                    const { stdout: output } = await execAsync('netstat -ano', { encoding: 'utf-8', timeout: 10000, windowsHide: true });
                    const lines = output.split('\n');
                    for (const line of lines) {
                        const match = line.match(/:(8\d{3})\s+.*LISTENING\s+(\d+)/);
                        if (match) {
                            const pid = parseInt(match[2]);
                            if (pid > 0 && pid !== process.pid) {
                                try {
                                    const { stdout: psOutput } = await execAsync(`powershell -Command "(Get-Process -Id ${pid}).ProcessName"`, { encoding: 'utf-8', timeout: 5000, windowsHide: true });
                                    const processName = psOutput.trim().toLowerCase();
                                    if (processName.includes('node') || processName.includes('python') || processName.includes('uvicorn')) {
                                        pidsToKill.push({ pid, info: processName });
                                    }
                                }
                                catch (e) { /* ignore */ }
                            }
                        }
                    }
                }
                catch (e) { /* ignore */ }
            }
            else {
                try {
                    const { stdout: output } = await execAsync('lsof -i :8000-8999 -t', { encoding: 'utf-8', timeout: 5000 });
                    const pids = output.split('\n').filter((p) => p.trim()).map((p) => parseInt(p));
                    for (const pid of pids) {
                        if (pid > 0 && pid !== process.pid) {
                            try {
                                // 验证进程名，只清理 node/python/uvicorn 进程
                                const { stdout: cmdOutput } = await execAsync(`ps -p ${pid} -o comm=`, { encoding: 'utf-8', timeout: 3000 });
                                const processName = cmdOutput.trim().toLowerCase();
                                if (processName.includes('node') || processName.includes('python') || processName.includes('uvicorn')) {
                                    pidsToKill.push({ pid, info: processName });
                                }
                            }
                            catch (e) { /* 进程已退出或无权限，忽略 */ }
                        }
                    }
                }
                catch (e) { /* ignore */ }
            }
            let killedCount = 0;
            for (const { pid, info } of pidsToKill) {
                try {
                    process.kill(pid, 'SIGTERM');
                    killedCount++;
                    logger.info(`Cleaned up subagent process: ${pid}`, { processName: info });
                }
                catch (e) { /* ignore */ }
            }
            if (killedCount > 0) {
                logger.info(`Cleaned up ${killedCount} subagent processes (ports 8000-8999)`);
            }
        }
        catch (e) {
            logger.warn(`Failed to cleanup subagent processes: ${e.message}`);
        }
    }
    /**
     * 服务器启动时清理遗留的子 Agent 进程
     * 在 resetStuckNodes 之后调用
     */
    static cleanupStaleSubagentProcesses() {
        try {
            // 检查是否有工作流正在运行
            const workflows = WorkflowModel.getAll();
            const runningWorkflows = workflows.filter((wf) => wf.executionStatus === 'running' || wf.status === 'running');
            if (runningWorkflows.length > 0) {
                logger.info(`Skipping cleanup: ${runningWorkflows.length} workflow(s) still running`);
                return;
            }
            // 没有工作流运行，安全清理遗留进程
            logger.info('Cleaning up stale subagent processes from previous session...');
            WorkflowService._cleanupSubagentProcesses().catch(e => logger.warn('Cleanup failed:', e.message));
        }
        catch (e) {
            logger.warn(`Failed to check running workflows: ${e.message}`);
        }
    }
    static _failWorkflow(workflowId, runId, errorMessage) {
        const workflow = WorkflowModel.findById(workflowId);
        if (!workflow)
            return;
        // 更新 executionLog 中的状态
        if (workflow.executionLog) {
            const logEntry = workflow.executionLog.find((l) => l.runId === runId);
            if (logEntry) {
                logEntry.status = 'failed';
                logEntry.completedAt = new Date().toISOString();
                WorkflowModel.update(workflowId, { executionLog: workflow.executionLog });
                // 强制同步保存，确保数据不丢失
                WorkflowModel._flush();
            }
        }
        for (const node of workflow.nodes) {
            if (node.status === 'running' || node.status === 'pending') {
                WorkflowModel.updateNodeStatus(workflowId, node.id, 'failed');
            }
        }
        WorkflowModel.update(workflowId, { executionStatus: 'failed' });
        WorkflowService._broadcastStatusUpdate(workflowId, 'failed', runId);
        logger.error(`Workflow failed: ${workflowId}`, { runId, error: errorMessage });
    }
    /**
     * Get list of agent nodes that require user input before execution
     */
    static getRequiredInputs(id) {
        const workflow = WorkflowModel.findById(id);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
        }
        return workflow.nodes
            .filter((n) => n.type === 'agent' && n.requiresInput)
            .map((n) => ({
            nodeId: n.id,
            label: n.label || n.id,
            defaultPrompt: n.defaultPrompt || '',
            agentId: n.agentId || null
        }));
    }
    /**
     * Save checkpoint files for completed workflow steps
     */
    static _saveCheckpoint(workflowId, workspaceRoot, nodes, masterOutput) {
        try {
            const fs = require('fs');
            const checkpointDir = path_1.default.join(workspaceRoot, '.checkpoint');
            if (!fs.existsSync(checkpointDir))
                fs.mkdirSync(checkpointDir, { recursive: true });
            const completedAt = new Date().toISOString();
            // Parse master output to extract per-node results
            for (const node of nodes) {
                if (node.type === 'start' || node.type === 'end')
                    continue;
                // Save each node's completion status with enhanced metadata
                const nodeFile = path_1.default.join(checkpointDir, `${node.id}.status.json`);
                const startedAt = node.startedAt || completedAt;
                const durationMs = node.startedAt ? (new Date(completedAt).getTime() - new Date(node.startedAt).getTime()) : null;
                fs.writeFileSync(nodeFile, JSON.stringify({
                    nodeId: node.id,
                    label: node.label || node.id,
                    type: node.type,
                    status: node.status || 'completed',
                    output: node.output || '',
                    startedAt,
                    completedAt,
                    duration: durationMs,
                    model: node.config?.model || null,
                    error: node.error || null,
                    updatedAt: completedAt
                }, null, 2), 'utf-8');
            }
            // Save master output
            const manifestFile = path_1.default.join(checkpointDir, 'manifest.json');
            fs.writeFileSync(manifestFile, JSON.stringify({
                workflowId,
                completedAt,
                nodesCompleted: nodes.filter(n => n.type !== 'start' && n.type !== 'end').length,
                outputLength: masterOutput.length
            }, null, 2), 'utf-8');
            logger.info(`Checkpoint saved for workflow ${workflowId} in ${checkpointDir}`);
        }
        catch (e) {
            logger.warn(`Failed to save checkpoint: ${e.message}`);
        }
    }
    /**
     * Save a single node's checkpoint file
     */
    static _saveNodeCheckpoint(workspaceRoot, nodeId, { label, output, model, startedAt, error }, workflowId) {
        try {
            const fs = require('fs');
            const completedAt = new Date().toISOString();
            const started = startedAt ? new Date(startedAt) : null;
            const durationMs = started ? (new Date(completedAt).getTime() - started.getTime()) : null;
            // Save to CheckpointService format (WORKFLOWS/checkpoints/)
            try {
                const CheckpointService = require('./CheckpointService');
                // Use a fixed runId per workflow execution so all nodes go into same checkpoint file
                const wfId = workflowId || 'default';
                const runId = WorkflowService._currentRunIds.get(wfId) || `checkpoint_${Date.now()}`;
                WorkflowService._currentRunIds.set(wfId, runId);
                // Load existing checkpoint to merge with
                const existingCheckpoint = CheckpointService.loadCheckpoint('current', runId) || {};
                const completedNodes = existingCheckpoint.completedNodes || {};
                // Add/update this node
                completedNodes[nodeId] = {
                    status: error ? 'failed' : 'completed',
                    output: (output || '').substring(0, 10000),
                    startedAt: startedAt || completedAt,
                    completedAt,
                    duration: durationMs,
                    model: model || null,
                    error: error || null
                };
                CheckpointService.saveCheckpoint('current', runId, {
                    completedNodes,
                    startedAt: existingCheckpoint.startedAt || completedAt,
                    completedAt,
                    workflowInput: existingCheckpoint.workflowInput || null
                });
                logger.info(`Node checkpoint saved: ${nodeId} -> CheckpointService`);
            }
            catch (e) {
                logger.warn(`Failed to save to CheckpointService: ${e.message}`);
            }
        }
        catch (e) {
            logger.warn(`Failed to save node checkpoint: ${e.message}`);
        }
    }
    /**
     * Load checkpoint data for workflow resumption
     */
    static _loadCheckpoint(workflowId, workspaceRoot) {
        try {
            const fs = require('fs');
            const checkpointDir = path_1.default.join(workspaceRoot, '.checkpoint');
            if (!fs.existsSync(checkpointDir))
                return null;
            const completedNodes = {};
            const files = fs.readdirSync(checkpointDir);
            for (const file of files) {
                if (file.endsWith('.status.json')) {
                    try {
                        const data = JSON.parse(fs.readFileSync(path_1.default.join(checkpointDir, file), 'utf-8'));
                        if (data.status === 'completed' || data.status === 'skipped') {
                            completedNodes[data.nodeId] = { status: data.status, output: data.output || '' };
                        }
                    }
                    catch (_) { }
                }
            }
            // Also check WorkflowModel for latest node statuses (includes parallel/merge nodes)
            try {
                const workflow = WorkflowModel.findById(workflowId);
                if (workflow && workflow.nodes) {
                    for (const node of workflow.nodes) {
                        if (node.status === 'completed' && !completedNodes[node.id]) {
                            completedNodes[node.id] = { status: 'completed', output: node.output || '' };
                        }
                    }
                }
            }
            catch (_) { }
            if (Object.keys(completedNodes).length === 0)
                return null;
            logger.info(`Checkpoint loaded for workflow ${workflowId}: ${Object.keys(completedNodes).length} nodes completed`);
            return { completedNodes };
        }
        catch (e) {
            logger.warn(`Failed to load checkpoint: ${e.message}`);
            return null;
        }
    }
    static _waitForApproval(workflowId, nodeId, requestId, timeoutMs = 600000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                WorkflowService._pendingApprovals.delete(requestId);
                reject(new Error('审批超时'));
            }, timeoutMs);
            WorkflowService._pendingApprovals.set(requestId, { resolve, reject, timer, workflowId, nodeId });
        });
    }
    /**
     * Resolve a pending approval Promise.
     */
    static handleApprovalDecision(requestId, decision, comment) {
        const pending = WorkflowService._pendingApprovals.get(requestId);
        if (!pending)
            return false;
        clearTimeout(pending.timer);
        WorkflowService._pendingApprovals.delete(requestId);
        if (decision === 'approve') {
            pending.resolve({ decision, comment });
        }
        else {
            pending.reject(new Error(`审批被拒绝${comment ? ': ' + comment : ''}`));
        }
        return true;
    }
    /**
     * Single-step execution: execute only one specific node using Master Agent approach.
     */
    static async step(workflowId, nodeId) {
        const workflow = WorkflowModel.findById(workflowId);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
        }
        const node = workflow.nodes.find((n) => n.id === nodeId);
        if (!node) {
            throw new AppError('NOT_FOUND', `Node with id '${nodeId}' not found in workflow '${workflowId}'`, 404);
        }
        const claudeService = WorkflowService._claudeService || global.__claudeService;
        if (!claudeService) {
            throw new AppError('EXECUTION_ERROR', 'ClaudeService not initialized', 500);
        }
        const workspaceRoot = workflow.folderPath || FileService.getWorkspaceRoot() || process.cwd();
        const runId = `step_${generateId()}`;
        // Build input from upstream outputs
        const upstreamInputs = [];
        const incomingEdges = workflow.edges.filter((e) => (e.target || e.to) === nodeId);
        for (const edge of incomingEdges) {
            const srcId = edge.source || edge.from || '';
            const sourceNode = workflow.nodes.find((n) => n.id === srcId);
            if (sourceNode && sourceNode.output) {
                upstreamInputs.push(sourceNode.output);
            }
        }
        const nodeInput = upstreamInputs.length > 0
            ? upstreamInputs.join('\n---\n')
            : (typeof workflow.context?.workflowInput === 'string'
                ? workflow.context.workflowInput
                : JSON.stringify(workflow.context?.workflowInput || ''));
        // Build a minimal workflow with just this node for MasterAgentService prompt generation
        const minimalWorkflow = { ...workflow, nodes: [node] };
        const MasterAgentService = require('./MasterAgentService');
        const systemPrompt = MasterAgentService.buildSystemPrompt(minimalWorkflow, nodeInput, workspaceRoot);
        WorkflowModel.updateNodeStatus(workflowId, nodeId, 'running');
        WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);
        try {
            const output = await claudeService.execute(runId, null, nodeInput, {
                systemPrompt,
                model: ApiKeyService.resolveModel('sonnet'),
                folderPath: workspaceRoot,
                workflowId,
                nodeId,
                runId,
            });
            WorkflowModel.updateNodeStatus(workflowId, nodeId, 'completed', output);
            WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);
            logger.info(`Step execution completed for node ${nodeId} in workflow ${workflowId}`);
            return { nodeId, input: nodeInput, output };
        }
        catch (err) {
            WorkflowModel.updateNodeStatus(workflowId, nodeId, 'failed', `Error: ${err.message}`);
            WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);
            throw new AppError('EXECUTION_ERROR', `Step execution failed for node '${nodeId}': ${err.message}`, 500);
        }
    }
    /**
     * Simulate workflow execution with mock data, without calling real Claude CLI
     */
    static async simulate(workflowId, mockData = {}) {
        const workflow = WorkflowModel.findById(workflowId);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
        }
        const nodes = workflow.nodes;
        const edges = workflow.edges;
        const nodeOutputs = new Map();
        // Build adjacency and indegree
        const adjacency = new Map();
        const indegree = new Map();
        const nodeMap = new Map();
        for (const node of nodes) {
            nodeMap.set(node.id, node);
            adjacency.set(node.id, []);
            indegree.set(node.id, 0);
        }
        for (const edge of edges) {
            const src = edge.source || edge.from || '';
            const tgt = edge.target || edge.to || '';
            if (src && tgt && adjacency.has(src) && indegree.has(tgt)) {
                adjacency.get(src).push(tgt);
                indegree.set(tgt, indegree.get(tgt) + 1);
            }
        }
        // Initial queue: all nodes with indegree 0
        let queue = [];
        for (const [nodeId, deg] of indegree) {
            if (deg === 0)
                queue.push(nodeId);
        }
        const results = {};
        while (queue.length > 0) {
            for (const nodeId of queue) {
                const node = nodeMap.get(nodeId);
                // Use mock data if provided, otherwise simulate output
                if (mockData[nodeId] !== undefined) {
                    const output = typeof mockData[nodeId] === 'string'
                        ? mockData[nodeId]
                        : JSON.stringify(mockData[nodeId]);
                    nodeOutputs.set(nodeId, output);
                    results[nodeId] = output;
                }
                else {
                    // Simulate based on node type
                    const simulatedOutput = WorkflowService._simulateNode(node, nodeOutputs, workflow);
                    nodeOutputs.set(nodeId, simulatedOutput);
                    results[nodeId] = simulatedOutput;
                }
            }
            // Build next layer
            const nextQueue = [];
            for (const nodeId of queue) {
                for (const targetId of adjacency.get(nodeId) || []) {
                    const newDegree = indegree.get(targetId) - 1;
                    indegree.set(targetId, newDegree);
                    if (newDegree === 0) {
                        nextQueue.push(targetId);
                    }
                }
            }
            queue = nextQueue;
        }
        logger.info(`Simulation completed for workflow ${workflowId}`);
        return { results, context: workflow.context || {} };
    }
    /**
     * Generate simulated output for a node without calling Claude CLI
     */
    static _simulateNode(node, nodeOutputs, workflow) {
        switch (node.type) {
            case 'start':
                return workflow.context?.workflowInput
                    ? (typeof workflow.context.workflowInput === 'string'
                        ? workflow.context.workflowInput
                        : JSON.stringify(workflow.context.workflowInput))
                    : 'Simulation started';
            case 'end': {
                const upstreamOutputs = [];
                const directUpstream = (workflow?.edges || []).filter(e => (e.target || e.to) === node.id).map(e => e.source || e.from || '');
                for (const upId of directUpstream) {
                    const out = nodeOutputs.get(upId);
                    if (out)
                        upstreamOutputs.push(out);
                }
                return upstreamOutputs.join('\n---\n') || 'Simulation completed';
            }
            case 'merge': {
                const mergeOutputs = [];
                const directUpstream = (workflow?.edges || []).filter(e => (e.target || e.to) === node.id).map(e => e.source || e.from || '');
                for (const upId of directUpstream) {
                    const out = nodeOutputs.get(upId);
                    if (out)
                        mergeOutputs.push(out);
                }
                return mergeOutputs.join('\n---\n') || '[Simulated] Merge completed';
            }
            case 'condition': {
                const pattern = node.config?.pattern || '';
                const trueLabel = node.config?.trueLabel || '通过';
                // In simulation, assume condition passes
                return `[Simulated] 条件判断 "${pattern}" → ${trueLabel}`;
            }
            case 'subworkflow':
                return `[Simulated] Subworkflow node "${node.label || node.id}" executed`;
            default:
                return `[Simulated] Node "${node.label || node.id}" executed`;
        }
    }
    /**
     * Test a single node with provided test input using Master Agent approach.
     */
    static async testNode(workflowId, nodeId, testInput) {
        const workflow = WorkflowModel.findById(workflowId);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
        }
        const node = workflow.nodes.find((n) => n.id === nodeId);
        if (!node) {
            throw new AppError('NOT_FOUND', `Node with id '${nodeId}' not found in workflow '${workflowId}'`, 404);
        }
        const claudeService = WorkflowService._claudeService || global.__claudeService;
        if (!claudeService) {
            throw new AppError('EXECUTION_ERROR', 'ClaudeService not initialized', 500);
        }
        const workspaceRoot = workflow.folderPath || FileService.getWorkspaceRoot() || process.cwd();
        const runId = `test_${generateId()}`;
        const nodeInput = typeof testInput === 'string' ? testInput : JSON.stringify(testInput || '');
        // Build a minimal workflow with just this node for MasterAgentService prompt generation
        const minimalWorkflow = { ...workflow, nodes: [node] };
        const MasterAgentService = require('./MasterAgentService');
        const systemPrompt = MasterAgentService.buildSystemPrompt(minimalWorkflow, nodeInput, workspaceRoot);
        WorkflowModel.updateNodeStatus(workflowId, nodeId, 'running');
        WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);
        try {
            const output = await claudeService.execute(runId, null, nodeInput, {
                systemPrompt,
                model: ApiKeyService.resolveModel('sonnet'),
                folderPath: workspaceRoot,
                workflowId,
                nodeId,
                runId,
            });
            WorkflowModel.updateNodeStatus(workflowId, nodeId, 'completed', output);
            WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);
            logger.info(`Node test completed for node ${nodeId} in workflow ${workflowId}`);
            return { nodeId, input: nodeInput, output };
        }
        catch (err) {
            WorkflowModel.updateNodeStatus(workflowId, nodeId, 'failed', `Error: ${err.message}`);
            WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);
            throw new AppError('EXECUTION_ERROR', `Node test failed for '${nodeId}': ${err.message}`, 500);
        }
    }
    /**
     * Get all node outputs and shared context variables for a workflow
     */
    static getVariables(workflowId) {
        const workflow = WorkflowModel.findById(workflowId);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
        }
        const nodes = {};
        for (const node of workflow.nodes) {
            nodes[node.id] = {
                label: node.label || node.id,
                type: node.type,
                status: node.status || 'pending',
                output: node.output || null
            };
        }
        return {
            nodes,
            context: workflow.context || {}
        };
    }
    /**
     * Batch execute a workflow with multiple parameter sets (sequential).
     */
    static async batchExecute(workflowId, paramsArray) {
        const workflow = WorkflowModel.findById(workflowId);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
        }
        if (!Array.isArray(paramsArray) || paramsArray.length === 0) {
            throw new AppError('VALIDATION_ERROR', 'paramsArray must be a non-empty array', 400);
        }
        const results = [];
        for (const params of paramsArray) {
            try {
                const { runId } = WorkflowService.execute(workflowId, params.input, params.params);
                // Wait for the execution to finish by polling executionStatus
                await WorkflowService._waitForMasterCompletion(workflowId, 300000);
                results.push({
                    runId,
                    status: 'completed',
                    input: params.input,
                    params: params.params
                });
            }
            catch (err) {
                results.push({
                    runId: null,
                    status: 'failed',
                    error: err.message,
                    input: params.input,
                    params: params.params
                });
            }
        }
        logger.info(`Batch execution completed for workflow ${workflowId} with ${paramsArray.length} parameter sets`);
        return results;
    }
    /**
     * Resume workflow execution from a checkpoint.
     */
    static resumeFromCheckpoint(workflowId, checkpoint) {
        const workflow = WorkflowModel.findById(workflowId);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
        }
        if (!checkpoint || !checkpoint.runId) {
            throw new AppError('VALIDATION_ERROR', '无效的检查点数据', 400);
        }
        logger.info(`Workflow resume from checkpoint: ${workflowId}`, { checkpointRunId: checkpoint.runId });
        // 使用checkpoint中的workflowInput，如果没有则使用工作流的lastInput或默认提示
        const workflowInput = checkpoint.workflowInput || workflow.context?.lastInput || '继续执行工作流';
        const { runId } = WorkflowService.execute(workflowId, workflowInput, {
            __resumeFromCheckpoint: true,
            __checkpointRunId: checkpoint.runId
        });
        return { runId, status: 'running' };
    }
    /**
     * Skip a failed node and continue workflow execution.
     */
    static skipNodeAndContinue(workflowId, nodeId) {
        const workflow = WorkflowModel.findById(workflowId);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow '${workflowId}' not found`, 404);
        }
        const node = workflow.nodes?.find((n) => n.id === nodeId);
        if (!node) {
            throw new AppError('NOT_FOUND', `Node '${nodeId}' not found in workflow`, 404);
        }
        if (node.status !== 'failed') {
            throw new AppError('VALIDATION_ERROR', `Node '${nodeId}' is not in failed status (current: ${node.status})`, 400);
        }
        // Mark the node as skipped
        WorkflowModel.updateNodeStatus(workflowId, nodeId, 'skipped', 'Skipped by user');
        WorkflowService._broadcastNodeUpdate(workflowId, workflow.currentRunId, nodeId);
        logger.info(`Workflow skip-node and continue: ${workflowId}`, { skippedNode: nodeId });
        const { runId } = WorkflowService.execute(workflowId, workflow.context?.lastInput || '', {
            __skipNode: nodeId
        });
        return { runId, status: 'running', skippedNode: nodeId };
    }
    /**
     * Poll WorkflowModel for executionStatus changes (used by batchExecute).
     */
    static async _waitForMasterCompletion(workflowId, timeoutMs = 300000) {
        const startTime = Date.now();
        while (true) {
            const workflow = WorkflowModel.findById(workflowId);
            if (!workflow) {
                throw new Error('Workflow not found');
            }
            if (workflow.executionStatus !== 'running' && workflow.executionStatus !== 'paused') {
                if (workflow.executionStatus === 'failed') {
                    throw new Error('Execution failed');
                }
                return; // completed or stopped
            }
            if (Date.now() - startTime > timeoutMs) {
                throw new Error('Execution timed out');
            }
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    /**
     * Stop a running workflow - sets status to stopped and rejects pending promises
     */
    static async stop(id) {
        const workflow = WorkflowModel.findById(id);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
        }
        if (workflow.executionStatus !== 'running' && workflow.executionStatus !== 'paused') {
            throw new AppError('CONFLICT', '只能停止运行中或已暂停的工作流', 409);
        }
        // 停止所有子Agent
        const orchestrator = WorkflowService._activeOrchestrators.get(id);
        if (orchestrator) {
            logger.info(`[Stop] 停止工作流 ${id} 的子Agent...`);
            await orchestrator.shutdownAll();
            WorkflowService._activeOrchestrators.delete(id);
        }
        WorkflowModel.update(id, { status: 'stopped', executionStatus: 'stopped' });
        logger.info(`[Stop] 工作流 ${id} 已停止`);
    }
    /**
     * Broadcast node status update via BroadcastService
     */
    static _broadcastNodeUpdate(workflowId, runId, nodeId) {
        const broadcastService = WorkflowService._broadcastService;
        if (!broadcastService)
            return;
        const workflow = WorkflowModel.findById(workflowId);
        if (!workflow)
            return;
        const node = workflow.nodes.find((n) => n.id === nodeId);
        if (!node)
            return;
        broadcastService.broadcast('workflow.nodeUpdate', {
            workflowId,
            workspaceId: workflow.workspaceId || null,
            runId,
            nodeId: node.id,
            label: node.label,
            status: node.status,
            output: node.output,
            startedAt: node.startedAt,
            completedAt: node.completedAt
        });
    }
    /**
     * Broadcast workflow status update via BroadcastService
     */
    static _broadcastStatusUpdate(workflowId, status, runId, summary) {
        const broadcastService = WorkflowService._broadcastService;
        if (!broadcastService)
            return;
        const workflow = WorkflowModel.findById(workflowId);
        const workspaceId = workflow?.workspaceId || null;
        const workflowName = workflow?.name || null;
        broadcastService.broadcast('workflow.statusUpdate', {
            workflowId,
            workflowName,
            workspaceId,
            status,
            runId,
            executionStatus: status,
            summary: summary || null
        });
    }
    /**
     * Calculate execution progress percentage
     */
    static _calculateProgress(workflowId) {
        const workflow = WorkflowModel.findById(workflowId);
        if (!workflow)
            return 0;
        const workNodes = workflow.nodes.filter((n) => n.type !== 'start' && n.type !== 'end');
        if (workNodes.length === 0)
            return 0;
        const completed = workNodes.filter((n) => n.status === 'completed').length;
        return Math.round((completed / workNodes.length) * 100);
    }
    /**
     * Pause workflow
     */
    static pause(id) {
        const workflow = WorkflowModel.findById(id);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
        }
        if (workflow.executionStatus !== 'running') {
            throw new AppError('CONFLICT', '只能暂停运行中的工作流', 409);
        }
        // Abort the SDK loop immediately (finishes current API call, then stops)
        const sdkService = global.__sdkService;
        if (sdkService && workflow.currentRunId) {
            sdkService.pause(`${workflow.currentRunId}_master`);
        }
        WorkflowModel.update(id, { status: 'paused', executionStatus: 'paused' });
        WorkflowService._broadcastStatusUpdate(id, 'paused', workflow.currentRunId);
        logger.info(`Workflow paused: ${id}`);
        return { status: 'paused' };
    }
    /**
     * Resume workflow
     */
    static resume(id) {
        const workflow = WorkflowModel.findById(id);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
        }
        if (workflow.executionStatus !== 'paused') {
            throw new AppError('CONFLICT', '只能恢复已暂停的工作流', 409);
        }
        WorkflowModel.update(id, { status: 'running', executionStatus: 'running' });
        WorkflowService._broadcastStatusUpdate(id, 'running', workflow.currentRunId);
        logger.info(`Workflow resumed: ${id}`);
        return { status: 'running' };
    }
    /**
     * Get workflow execution status (simple)
     */
    static getStatus(id) {
        const workflow = WorkflowModel.findById(id);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
        }
        const latestRun = workflow.executionLog.length > 0
            ? workflow.executionLog[workflow.executionLog.length - 1]
            : null;
        let progress = 0;
        let currentNodeId = null;
        if (latestRun && latestRun.nodeResults.length > 0) {
            const workResults = latestRun.nodeResults.filter((nr) => {
                const n = workflow.nodes.find((nd) => nd.id === nr.nodeId);
                return n && n.type !== 'start' && n.type !== 'end';
            });
            progress = workResults.length > 0
                ? Math.round((workResults.filter((n) => n.status === 'completed').length / workResults.length) * 100)
                : 0;
            const runningNode = latestRun.nodeResults.find((n) => n.status === 'running');
            if (runningNode) {
                currentNodeId = runningNode.nodeId;
            }
        }
        return {
            status: workflow.status,
            currentNodeId,
            progress,
            runId: latestRun ? latestRun.runId : null
        };
    }
    /**
     * Set the working folder for a workflow
     */
    static setFolder(id, folderPath) {
        const workflow = WorkflowModel.findById(id);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
        }
        // Validate folderPath is a non-empty string
        if (!folderPath || typeof folderPath !== 'string') {
            throw new AppError('VALIDATION_ERROR', 'folderPath must be a non-empty string', 400);
        }
        const fs = require('fs');
        const resolved = path_1.default.resolve(folderPath);
        if (!fs.existsSync(resolved)) {
            throw new AppError('NOT_FOUND', `Directory does not exist: ${folderPath}`, 404);
        }
        if (!fs.statSync(resolved).isDirectory()) {
            throw new AppError('VALIDATION_ERROR', '路径不是目录', 400);
        }
        const updated = WorkflowModel.update(id, { folderPath: resolved });
        logger.info(`Workflow folder set: ${id}`, { folderPath: resolved });
        return updated;
    }
    /**
     * Clear the working folder for a workflow (make it global)
     */
    static clearFolder(id) {
        const workflow = WorkflowModel.findById(id);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
        }
        const updated = WorkflowModel.update(id, { folderPath: null });
        logger.info(`Workflow folder cleared: ${id}`);
        return updated;
    }
    /**
     * Get detailed execution status for a workflow
     */
    static getExecutionStatus(id) {
        const workflow = WorkflowModel.findById(id);
        if (!workflow) {
            throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
        }
        if (!workflow.currentRunId || workflow.executionStatus === 'idle') {
            return {
                workflowId: id,
                runId: null,
                status: 'idle',
                startedAt: null,
                completedAt: null,
                progress: 0,
                nodes: workflow.nodes.map((n) => ({
                    nodeId: n.id,
                    label: n.label || n.id,
                    type: n.type,
                    agentId: n.agentId || null,
                    status: n.status || 'pending',
                    output: n.output || null,
                    startedAt: n.startedAt || null,
                    completedAt: n.completedAt || null,
                    logs: n.logs || []
                })),
                edges: (workflow.edges || []).map((e) => ({
                    source: e.source || e.from || '',
                    target: e.target || e.to || ''
                }))
            };
        }
        const latestRun = workflow.executionLog.find((e) => e.runId === workflow.currentRunId)
            || workflow.executionLog[workflow.executionLog.length - 1];
        if (!latestRun) {
            return {
                workflowId: id,
                runId: null,
                status: 'idle',
                startedAt: null,
                completedAt: null,
                progress: 0,
                nodes: workflow.nodes.map((n) => ({
                    nodeId: n.id,
                    label: n.label || n.id,
                    type: n.type,
                    agentId: n.agentId || null,
                    status: n.status || 'pending',
                    output: null,
                    startedAt: null,
                    completedAt: null,
                    logs: []
                })),
                edges: (workflow.edges || []).map((e) => ({
                    source: e.source || e.from || '',
                    target: e.target || e.to || ''
                }))
            };
        }
        const workNodes = workflow.nodes.filter((n) => n.type !== 'start' && n.type !== 'end');
        const completedCount = workNodes.filter((n) => n.status === 'completed').length;
        const progress = workNodes.length > 0
            ? Math.round((completedCount / workNodes.length) * 100)
            : 0;
        return {
            workflowId: id,
            runId: latestRun.runId,
            status: workflow.executionStatus,
            startedAt: latestRun.startedAt,
            completedAt: latestRun.completedAt,
            progress,
            nodes: workflow.nodes.map((n) => ({
                nodeId: n.id,
                label: n.label || n.id,
                type: n.type,
                agentId: n.agentId || null,
                status: n.status || 'pending',
                output: n.output || null,
                startedAt: n.startedAt || null,
                completedAt: n.completedAt || null,
                logs: n.logs || []
            })),
            edges: (workflow.edges || []).map((e) => ({
                source: e.source || e.from || '',
                target: e.target || e.to || ''
            }))
        };
    }
}
exports.WorkflowService = WorkflowService;
// 使用 CommonJS 导出以保持与现有路由的兼容性
module.exports = WorkflowService;
module.exports.WorkflowService = WorkflowService;
module.exports.default = WorkflowService;
//# sourceMappingURL=WorkflowService.js.map