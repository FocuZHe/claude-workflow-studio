/**
 * Workflow business logic service
 */

import path from 'path';

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

import type { BroadcastService } from './BroadcastService';

// 类型定义
export interface WorkflowNode {
  id: string;
  type: string;
  label?: string;
  agentId?: string;
  status?: string;
  output?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  defaultPrompt?: string;
  requiresInput?: boolean;
  config?: {
    model?: string;
    systemPrompt?: string;
    [key: string]: any;
  };
  skillNames?: string[];
  logs?: any[];
  error?: string;
}

export interface WorkflowEdge {
  id?: string;
  source?: string;
  from?: string;
  target?: string;
  to?: string;
  label?: string;
}

export interface WorkflowData {
  id: string;
  name?: string;
  description?: string;
  status: string;
  executionStatus: string;
  currentRunId?: string | null;
  folderPath?: string | null;
  workspaceId?: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  executionLog: ExecutionLogEntry[];
  context?: Record<string, any>;
  error?: string;
  memoryEnabled?: boolean;  // 是否启用记忆注入（默认false）
  memorySource?: any;
  knowledgeSource?: any;
}

export interface ExecutionLogEntry {
  runId: string;
  startedAt: Date;
  completedAt: Date | null;
  status: string;
  nodeResults: NodeResult[];
}

export interface NodeResult {
  nodeId: string;
  status: string;
  output: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  hasStart?: boolean;
  hasEnd?: boolean;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface ApprovalEntry {
  resolve: (value: { decision: string; comment?: string }) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  workflowId: string;
  nodeId: string;
}

export interface ExecuteResult {
  runId: string;
  status: string;
}

export interface NodeRegistryEntry {
  label: string;
  model: string;
  toolPermissions: Record<string, boolean>;
  systemPrompt: string;
  rolePrompt: string;
  task: string;
  skills: string[];
  mcp: string[];
}

export interface StepResult {
  nodeId: string;
  input: string;
  output: string;
}

export interface SimulationResult {
  results: Record<string, string>;
  context: Record<string, any>;
}

export interface ExecutionStatusResult {
  workflowId: string;
  runId: string | null;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  progress: number;
  nodes: Array<{
    nodeId: string;
    label: string;
    type: string;
    agentId: string | null;
    status: string;
    output: string | null;
    startedAt: string | null;
    completedAt: string | null;
    logs: any[];
  }>;
  edges: Array<{ source: string; target: string }>;
}

export interface BatchExecuteResult {
  runId: string | null;
  status: string;
  input?: any;
  params?: any;
  error?: string;
}

export interface VariablesResult {
  nodes: Record<string, {
    label: string;
    type: string;
    status: string;
    output: string | null;
  }>;
  context: Record<string, any>;
}

export class WorkflowService {
  static _broadcastService: BroadcastService | null = null;
  static _claudeService: any = null;
  static _pendingApprovals: Map<string, ApprovalEntry> = new Map();
  static _currentRunIds: Map<string, string> = new Map();  // workflowId -> runId（防止并发覆盖）
  static _activeOrchestrators: Map<string, { shutdownAll: () => Promise<void> }> = new Map();  // workflowId -> WorkflowOrchestrator（用于停止工作流时关闭子Agent）

  /**
   * Initialize WorkflowService with dependencies
   */
  static init(broadcastService: BroadcastService, claudeService?: any): void {
    WorkflowService._broadcastService = broadcastService;
    if (claudeService) {
      WorkflowService._claudeService = claudeService;
    }
  }

  static _usesInjectedTestClaudeService(): boolean {
    const service = WorkflowService._claudeService;
    return process.env.NODE_ENV === 'test'
      && !!service
      && service.constructor?.name !== 'ClaudeService';
  }

  static _resolveModel(alias: string): string {
    if (WorkflowService._usesInjectedTestClaudeService()) {
      return alias;
    }
    return ApiKeyService.resolveModel(alias);
  }

  /**
   * 修复卡在 'running' 的 executionLog 记录
   * 服务器重启后：
   * - 有 checkpoint 的工作流 → 标记为 interrupted（可恢复）
   * - 没有 checkpoint 的 → 标记为 failed
   */
  static fixStaleExecutionLogs(): void {
    try {
      const workflows: WorkflowData[] = WorkflowModel.getAll();
      let fixedCount = 0;
      let interruptedCount = 0;

      for (const wf of workflows) {
        if (!wf.executionLog || wf.executionLog.length === 0) continue;

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
            } catch (checkpointErr) {
              // 检查点读取失败时记录日志，但仍标记为 interrupted 让用户可以手动恢复
              logger?.warn?.(`Failed to read checkpoint for workflow ${wf.id}:`, checkpointErr);
              hasCheckpoint = true; // 假设有检查点，让用户手动决定
            }

            if (hasCheckpoint) {
              // 有 checkpoint：标记为 interrupted，用户可以手动恢复
              log.status = 'interrupted';
              changed = true;
              interruptedCount++;
            } else {
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
    } catch (e: any) {
      logger.warn('[Recovery] executionLog 修复失败:', e.message);
    }
  }

  /**
   * Phase 3: 崩溃恢复 - 服务器启动时检查中断的工作流
   * 1. 检查 running 状态的工作流，标记为 interrupted
   * 2. 清理残留的 session-store 中的过期任务
   */
  static recoverInterruptedWorkflows(): void {
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
          const item = value as any;
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
    } catch (e: any) {
      logger.warn('[Recovery] Session store 清理失败:', e.message);
    }

    logger.info('[Recovery] 崩溃恢复检查完成');
  }

  /**
   * Reset nodes that were waiting for human intervention when server restarted.
   */
  static resetStuckNodes(): void {
    try {
      const workflows: WorkflowData[] = WorkflowModel.getAll();
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
          } catch (e) { /* checkpoint check is best-effort */ }
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
    } catch (err: any) {
      logger.warn(`Failed to reset stuck nodes: ${err.message}`);
    }
  }

  /**
   * Create a new workflow
   */
  static create(data: Partial<WorkflowData>): WorkflowData {
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
  static list(filters?: Record<string, any>): any {
    return WorkflowModel.findAll(filters);
  }

  /**
   * Get workflow by ID
   */
  static getById(id: string): WorkflowData {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }
    return workflow;
  }

  /**
   * Update workflow with graph validation
   */
  static update(id: string, data: Partial<WorkflowData>): WorkflowData {
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
  static delete(id: string): boolean {
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
  static _cleanupWorkflowResources(workflowId: string): void {
    try {
      const MemoryService = require('./MemoryService');
      MemoryService.deleteMemory(workflowId);
      MemoryService.cleanSharedPool(workflowId);
    } catch (e: any) { logger.warn(`Failed to delete memory for workflow ${workflowId}: ${e.message}`); }

    try {
      const CheckpointService = require('./CheckpointService');
      CheckpointService.deleteAllCheckpoints(workflowId);
    } catch (e: any) { logger.warn(`Failed to delete checkpoints for workflow ${workflowId}: ${e.message}`); }

    try {
      const SnapshotService = require('./SnapshotService');
      const snapshots = SnapshotService.getSnapshots(workflowId);
      if (Array.isArray(snapshots)) {
        for (const s of snapshots) {
          try { SnapshotService.delete(workflowId, s.id); } catch (e) { /* ignore */ }
        }
      }
    } catch (e: any) { logger.warn(`Failed to delete snapshots for workflow ${workflowId}: ${e.message}`); }
  }

  /**
   * Validate workflow graph integrity
   */
  static validateGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): ValidationResult {
    const errors: ValidationError[] = [];

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
      } else {
        const connectedNodes = new Set<string>();
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
  static validateAgentReferences(nodes: WorkflowNode[]): { valid: boolean; errors: ValidationError[] } {
    const errors: ValidationError[] = [];
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
  static execute(id: string, input?: any, params?: Record<string, any>, nodeInputs?: Record<string, any>): ExecuteResult {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }

    // 防止并发执行：检查工作流是否已在运行
    if (workflow.executionStatus === 'running' && !WorkflowService._usesInjectedTestClaudeService()) {
      throw new AppError('CONFLICT', `工作流 "${workflow.name}" 正在运行中，请等待完成后再执行`, 409);
    }

    // Validate graph has start node
    const hasStart = workflow.nodes.some((n: WorkflowNode) => n.type === 'start');
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
      } catch (e) {
        // 回退到原有逻辑
        const workspaceRoot = FileService.getWorkspaceRoot();
        if (workspaceRoot) {
          WorkflowModel.update(id, { folderPath: workspaceRoot });
          logger.info(`Workflow ${id} folderPath set to workspace root: ${workspaceRoot}`);
        }
      }
    }

    const runId = generateId();
    const executionEntry: ExecutionLogEntry = {
      runId,
      startedAt: new Date(),
      completedAt: null,
      status: 'running',
      nodeResults: workflow.nodes.map((n: WorkflowNode) => ({
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
    const visitedSet = new Set<string>(existingVisited);
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

    if (WorkflowService._usesInjectedTestClaudeService()) {
      WorkflowService._executeWithInjectedClaudeService(id, runId, input, workflow).catch((err: Error) => {
        logger.error(`Injected ClaudeService execution error: ${id}`, { runId, error: err.message });
        WorkflowService._failWorkflow(id, runId, err.message);
      });
      return { runId, status: 'running' };
    }

    // Always use Master Agent mode
    logger.info(`Workflow ${id}: using MasterAgent mode (native Agent tool collaboration)`);
    WorkflowService._executeMasterAgentWithRetry(id, runId, input, workflow, 1).catch((err: Error) => {
      logger.error(`MasterAgent execution error: ${id}`, { runId, error: err.message, stack: err.stack });
      try {
        WorkflowService._failWorkflow(id, runId, err.message);
      } catch (failErr: any) {
        // Last resort: directly update workflow status to prevent stuck "running" state
        logger.error(`Failed to mark workflow as failed: ${id}`, { error: failErr.message });
        try {
          WorkflowModel.update(id, { status: 'failed', executionStatus: 'failed', error: err.message });
        } catch (_) {
          logger.error(`CRITICAL: Cannot update workflow status for ${id}.workflow may be stuck.`);
        }
      }
    });

    return { runId, status: 'running' };
  }

  static async _executeWithInjectedClaudeService(
    workflowId: string,
    runId: string,
    input: any,
    workflow: WorkflowData
  ): Promise<void> {
    const claudeService = WorkflowService._claudeService;
    if (!claudeService) {
      throw new Error('ClaudeService not initialized');
    }

    const workspaceRoot = workflow.folderPath || FileService.getWorkspaceRoot() || process.cwd();
    const nodes: WorkflowNode[] = workflow.nodes || [];
    const edges: WorkflowEdge[] = workflow.edges || [];
    const nodeMap = new Map<string, WorkflowNode>();
    const nodeOutputs = new Map<string, string>();
    const adjacency = new Map<string, string[]>();
    const indegree = new Map<string, number>();

    for (const node of nodes) {
      nodeMap.set(node.id, node);
      adjacency.set(node.id, []);
      indegree.set(node.id, 0);
    }

    for (const edge of edges) {
      const source = edge.source || edge.from || '';
      const target = edge.target || edge.to || '';
      if (source && target && adjacency.has(source) && indegree.has(target)) {
        adjacency.get(source)!.push(target);
        indegree.set(target, indegree.get(target)! + 1);
      }
    }

    let queue = Array.from(indegree.entries())
      .filter(([, degree]) => degree === 0)
      .map(([nodeId]) => nodeId);
    const workflowInput = typeof input === 'string' ? input : JSON.stringify(input || '');
    const context = { ...(workflow.context || {}), workflowInput };
    WorkflowModel.update(workflowId, { context });

    while (queue.length > 0) {
      const currentLayer = queue;
      queue = [];

      await Promise.all(currentLayer.map(async (nodeId) => {
        const node = nodeMap.get(nodeId);
        if (!node) return;

        WorkflowModel.updateNodeStatus(workflowId, node.id, 'running');
        WorkflowService._broadcastNodeUpdate(workflowId, runId, node.id);

        const upstreamOutputs = edges
          .filter((edge) => (edge.target || edge.to) === node.id)
          .map((edge) => nodeOutputs.get(edge.source || edge.from || ''))
          .filter(Boolean) as string[];
        const nodeInput = upstreamOutputs.length > 0 ? upstreamOutputs.join('\n---\n') : workflowInput;

        let output: string;
        if (node.type === 'agent') {
          output = await claudeService.execute(`${runId}_${node.id}`, node.agentId || null, nodeInput, {
            model: WorkflowService._resolveModel('sonnet'),
            folderPath: workspaceRoot,
            workflowId,
            nodeId: node.id,
            runId,
          });
        } else if (node.type === 'start') {
          output = nodeInput || 'Simulation started';
        } else {
          output = WorkflowService._simulateNode(node, nodeOutputs, {
            ...workflow,
            context,
          });
        }

        nodeOutputs.set(node.id, output);
        WorkflowModel.updateNodeStatus(workflowId, node.id, 'completed', output);
        WorkflowService._broadcastNodeUpdate(workflowId, runId, node.id);
      }));

      for (const nodeId of currentLayer) {
        for (const targetId of adjacency.get(nodeId) || []) {
          const nextDegree = (indegree.get(targetId) || 0) - 1;
          indegree.set(targetId, nextDegree);
          if (nextDegree === 0) queue.push(targetId);
        }
      }
    }

    const completedWorkflow = WorkflowModel.findById(workflowId);
    if (completedWorkflow && completedWorkflow.executionLog) {
      const logEntry = completedWorkflow.executionLog.find((log: any) => log.runId === runId);
      if (logEntry) {
        logEntry.status = 'completed';
        logEntry.completedAt = new Date().toISOString();
        logEntry.nodeResults = (completedWorkflow.nodes || []).map((node: WorkflowNode) => ({
          nodeId: node.id,
          status: node.status || 'completed',
          output: node.output || null,
          startedAt: node.startedAt || null,
          completedAt: node.completedAt || null
        }));
        WorkflowModel.update(workflowId, { executionLog: completedWorkflow.executionLog });
      }
    }

    WorkflowModel.update(workflowId, { status: 'completed', executionStatus: 'completed', currentRunId: runId });
    WorkflowModel._flush();
    WorkflowService._broadcastStatusUpdate(workflowId, 'completed', runId);
  }

  /**
   * 带重试的主Agent执行 - 自动处理429等可重试错误
   */
  static async _executeMasterAgentWithRetry(
    workflowId: string,
    runId: string,
    input: any,
    workflow: WorkflowData,
    maxRetries: number = 3
  ): Promise<void> {
    let lastError: Error | null = null;
    let currentWorkflow = workflow;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`Workflow ${workflowId} attempt ${attempt}/${maxRetries}`);
        // 使用 WorkflowOrchestrator（双轨闭环架构）执行工作流
        await WorkflowService._executeWithOrchestrator(workflowId, runId, input, currentWorkflow);
        logger.info(`Workflow ${workflowId} attempt ${attempt} succeeded`);
        return; // 成功，直接返回
      } catch (err: any) {
        lastError = err;
        const errorInfo = WorkflowService._parseError(err);

        // 检查是否可重试
        if (!errorInfo.retryable || attempt >= maxRetries) {
          // 构建用户友好的错误信息
          let userMessage = errorInfo.message;
          if (errorInfo.type === 'RATE_LIMITED') {
            userMessage = `API 请求频率超限（429错误）。已重试 ${attempt} 次均失败。\n\n建议操作：\n1. 等待几分钟后手动重新执行工作流\n2. 减少同时运行的工作流数量\n3. 检查 API 配额是否充足`;
          } else if (errorInfo.type === 'SERVICE_OVERLOADED') {
            userMessage = `API 服务暂时过载（529错误）。已重试 ${attempt} 次均失败。\n\n建议操作：\n1. 等待几分钟后手动重新执行工作流\n2. 稍后再试`;
          }

          // 创建带用户友好信息的错误
          const enhancedErr = new Error(userMessage) as Error & {
            errorType?: string;
            retryable?: boolean;
            originalError?: Error;
          };
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
        } catch (_) { /* ignore */ }

        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, delay));

        // 重新加载工作流状态（可能已被检查点更新）
        const freshWorkflow = WorkflowModel.findById(workflowId);
        if (freshWorkflow) {
          currentWorkflow = freshWorkflow;
        }
      }
    }
    throw lastError!;
  }

  /**
   * 解析错误信息，判断是否可重试
   */
  static _parseError(err: Error): { type: string; message: string; retryable: boolean } {
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
  static async _executeWithOrchestrator(
    workflowId: string,
    runId: string,
    input: any,
    workflow: WorkflowData
  ): Promise<void> {
    const workspaceRoot = workflow.folderPath || FileService.getWorkspaceRoot() || process.cwd();

    // 创建状态存储适配器（支持 Session 恢复）
    const stateStore = {
      save: async (key: string, value: any) => {
        // 保存到工作流上下文
        const context = workflow.context || {};
        context[key] = value;
        WorkflowModel.update(workflowId, { context });
        // 同时持久化到文件（用于崩溃恢复）
        try {
          const fs = require('fs');
          const path = require('path');
          const storePath = path.join(process.cwd(), 'data', 'session-store.json');
          let store: any = {};
          try {
            const content = fs.readFileSync(storePath, 'utf-8');
            store = JSON.parse(content);
          } catch (parseErr) {
            // JSON 解析失败时备份损坏的文件，避免数据丢失
            try {
              const backupPath = storePath + '.corrupted.' + Date.now();
              fs.copyFileSync(storePath, backupPath);
              logger?.warn?.(`Session store corrupted, backed up to ${backupPath}`);
            } catch (_) {}
          }
          store[key] = value;
          fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
        } catch (_) {}
      },
      get: async (key: string) => {
        // 优先从工作流上下文获取
        if (workflow.context?.[key]) return workflow.context[key];
        // 回退到文件存储
        try {
          const fs = require('fs');
          const path = require('path');
          const storePath = path.join(process.cwd(), 'data', 'session-store.json');
          const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
          return store[key] || null;
        } catch (_) {
          return null;
        }
      },
      query: async (filter: { status: string }) => {
        // 查询所有运行中的任务
        try {
          const fs = require('fs');
          const path = require('path');
          const storePath = path.join(process.cwd(), 'data', 'session-store.json');
          const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
          return Object.values(store).filter((item: any) => item.status === filter.status);
        } catch (_) {
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
      const result = await orchestrator.startMasterCommander(
        typeof input === 'string' ? input : JSON.stringify(input || '执行工作流'),
        workflow as any,
        runId
      );

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
            const agentMemories: string[] = MemoryService.extractAgentMemory(result.output);
            let memoryEntry = memSummary;
            if (agentMemories.length > 0) {
              memoryEntry += '\n\nAgent 主动记忆:\n' + agentMemories.map((m: string) => `- ${m}`).join('\n');
            }
            const tag = (input || '').substring(0, 50).replace(/\n/g, ' ').trim();
            MemoryService.appendMemoryWithTag(workflowId, memoryEntry, tag);
            logger.info(`[Orchestrator] 记忆已保存: ${workflowId}`);
          } catch (e: any) {
            logger.warn(`[Orchestrator] 保存记忆失败: ${e.message}`);
          }
        }

        // 更新 executionLog 中的状态
        const completedWorkflow = WorkflowModel.findById(workflowId);
        if (completedWorkflow && completedWorkflow.executionLog) {
          const logEntry = completedWorkflow.executionLog.find((l: any) => l.runId === runId);
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
      } else {
        throw new Error(result.error || '工作流执行失败');
      }
    } catch (err: any) {
      logger.error(`[Orchestrator] 工作流失败: ${workflowId}`, { error: err.message });
      await orchestrator.shutdownAll();
      throw err;
    } finally {
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
  static async _cleanupSubagentProcesses(workspaceRoot?: string): Promise<void> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // 查找占用 8000-8999 端口的进程
      const platform = process.platform;
      const pidsToKill: Array<{ pid: number; info: string }> = [];

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
                  const { stdout: psOutput } = await execAsync(
                    `powershell -Command "(Get-Process -Id ${pid}).ProcessName"`,
                    { encoding: 'utf-8', timeout: 5000, windowsHide: true }
                  );
                  const processName = psOutput.trim().toLowerCase();
                  if (processName.includes('node') || processName.includes('python') || processName.includes('uvicorn')) {
                    pidsToKill.push({ pid, info: processName });
                  }
                } catch (e) { /* ignore */ }
              }
            }
          }
        } catch (e) { /* ignore */ }
      } else {
        try {
          const { stdout: output } = await execAsync('lsof -i :8000-8999 -t', { encoding: 'utf-8', timeout: 5000 });
          const pids = output.split('\n').filter((p: string) => p.trim()).map((p: string) => parseInt(p));
          for (const pid of pids) {
            if (pid > 0 && pid !== process.pid) {
              try {
                // 验证进程名，只清理 node/python/uvicorn 进程
                const { stdout: cmdOutput } = await execAsync(
                  `ps -p ${pid} -o comm=`, { encoding: 'utf-8', timeout: 3000 }
                );
                const processName = cmdOutput.trim().toLowerCase();
                if (processName.includes('node') || processName.includes('python') || processName.includes('uvicorn')) {
                  pidsToKill.push({ pid, info: processName });
                }
              } catch (e) { /* 进程已退出或无权限，忽略 */ }
            }
          }
        } catch (e) { /* ignore */ }
      }

      let killedCount = 0;
      for (const { pid, info } of pidsToKill) {
        try {
          process.kill(pid, 'SIGTERM');
          killedCount++;
          logger.info(`Cleaned up subagent process: ${pid}`, { processName: info });
        } catch (e) { /* ignore */ }
      }

      if (killedCount > 0) {
        logger.info(`Cleaned up ${killedCount} subagent processes (ports 8000-8999)`);
      }
    } catch (e: any) {
      logger.warn(`Failed to cleanup subagent processes: ${e.message}`);
    }
  }

  /**
   * 服务器启动时清理遗留的子 Agent 进程
   * 在 resetStuckNodes 之后调用
   */
  static cleanupStaleSubagentProcesses(): void {
    try {
      // 检查是否有工作流正在运行
      const workflows: WorkflowData[] = WorkflowModel.getAll();
      const runningWorkflows = workflows.filter((wf: WorkflowData) =>
        wf.executionStatus === 'running' || wf.status === 'running'
      );

      if (runningWorkflows.length > 0) {
        logger.info(`Skipping cleanup: ${runningWorkflows.length} workflow(s) still running`);
        return;
      }

      // 没有工作流运行，安全清理遗留进程
      logger.info('Cleaning up stale subagent processes from previous session...');
      WorkflowService._cleanupSubagentProcesses().catch(e => logger.warn('Cleanup failed:', e.message));
    } catch (e: any) {
      logger.warn(`Failed to check running workflows: ${e.message}`);
    }
  }

  static _failWorkflow(workflowId: string, runId: string, errorMessage: string): void {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) return;

    // 更新 executionLog 中的状态
    if (workflow.executionLog) {
      const logEntry = workflow.executionLog.find((l: any) => l.runId === runId);
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
  static getRequiredInputs(id: string): Array<{ nodeId: string; label: string; defaultPrompt: string; agentId: string | null }> {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }

    return workflow.nodes
      .filter((n: WorkflowNode) => n.type === 'agent' && n.requiresInput)
      .map((n: WorkflowNode) => ({
        nodeId: n.id,
        label: n.label || n.id,
        defaultPrompt: n.defaultPrompt || '',
        agentId: n.agentId || null
      }));
  }

  /**
   * Save checkpoint files for completed workflow steps
   */
  static _saveCheckpoint(workflowId: string, workspaceRoot: string, nodes: WorkflowNode[], masterOutput: string): void {
    try {
      const fs = require('fs');
      const checkpointDir = path.join(workspaceRoot, '.checkpoint');
      if (!fs.existsSync(checkpointDir)) fs.mkdirSync(checkpointDir, { recursive: true });

      const completedAt = new Date().toISOString();

      // Parse master output to extract per-node results
      for (const node of nodes) {
        if (node.type === 'start' || node.type === 'end') continue;
        // Save each node's completion status with enhanced metadata
        const nodeFile = path.join(checkpointDir, `${node.id}.status.json`);
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
      const manifestFile = path.join(checkpointDir, 'manifest.json');
      fs.writeFileSync(manifestFile, JSON.stringify({
        workflowId,
        completedAt,
        nodesCompleted: nodes.filter(n => n.type !== 'start' && n.type !== 'end').length,
        outputLength: masterOutput.length
      }, null, 2), 'utf-8');

      logger.info(`Checkpoint saved for workflow ${workflowId} in ${checkpointDir}`);
    } catch (e: any) {
      logger.warn(`Failed to save checkpoint: ${e.message}`);
    }
  }

  /**
   * Save a single node's checkpoint file
   */
  static _saveNodeCheckpoint(
    workspaceRoot: string,
    nodeId: string,
    { label, output, model, startedAt, error }: { label: string; output?: string; model?: string; startedAt?: string; error?: string },
    workflowId?: string
  ): void {
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
      } catch (e: any) {
        logger.warn(`Failed to save to CheckpointService: ${e.message}`);
      }
    } catch (e: any) {
      logger.warn(`Failed to save node checkpoint: ${e.message}`);
    }
  }

  /**
   * Load checkpoint data for workflow resumption
   */
  static _loadCheckpoint(workflowId: string, workspaceRoot: string): { completedNodes: Record<string, { status: string; output: string }> } | null {
    try {
      const fs = require('fs');
      const checkpointDir = path.join(workspaceRoot, '.checkpoint');
      if (!fs.existsSync(checkpointDir)) return null;

      const completedNodes: Record<string, { status: string; output: string }> = {};
      const files: string[] = fs.readdirSync(checkpointDir);
      for (const file of files) {
        if (file.endsWith('.status.json')) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(checkpointDir, file), 'utf-8'));
            if (data.status === 'completed' || data.status === 'skipped') {
              completedNodes[data.nodeId] = { status: data.status, output: data.output || '' };
            }
          } catch (_) {}
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
      } catch (_) {}

      if (Object.keys(completedNodes).length === 0) return null;

      logger.info(`Checkpoint loaded for workflow ${workflowId}: ${Object.keys(completedNodes).length} nodes completed`);
      return { completedNodes };
    } catch (e: any) {
      logger.warn(`Failed to load checkpoint: ${e.message}`);
      return null;
    }
  }

  static _waitForApproval(
    workflowId: string,
    nodeId: string,
    requestId: string,
    timeoutMs: number = 600000
  ): Promise<{ decision: string; comment?: string }> {
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
  static handleApprovalDecision(requestId: string, decision: string, comment?: string): boolean {
    const pending = WorkflowService._pendingApprovals.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    WorkflowService._pendingApprovals.delete(requestId);

    if (decision === 'approve') {
      pending.resolve({ decision, comment });
    } else {
      pending.reject(new Error(`审批被拒绝${comment ? ': ' + comment : ''}`));
    }
    return true;
  }

  /**
   * Single-step execution: execute only one specific node using Master Agent approach.
   */
  static async step(workflowId: string, nodeId: string): Promise<StepResult> {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
    }

    const node = workflow.nodes.find((n: WorkflowNode) => n.id === nodeId);
    if (!node) {
      throw new AppError('NOT_FOUND', `Node with id '${nodeId}' not found in workflow '${workflowId}'`, 404);
    }

    const claudeService = WorkflowService._claudeService || (global as any).__claudeService;
    if (!claudeService) {
      throw new AppError('EXECUTION_ERROR', 'ClaudeService not initialized', 500);
    }

    const workspaceRoot = workflow.folderPath || FileService.getWorkspaceRoot() || process.cwd();
    const runId = `step_${generateId()}`;

    // Build input from upstream outputs
    const upstreamInputs: string[] = [];
    const incomingEdges = workflow.edges.filter((e: WorkflowEdge) => (e.target || e.to) === nodeId);
    for (const edge of incomingEdges) {
      const srcId = edge.source || edge.from || '';
      const sourceNode = workflow.nodes.find((n: WorkflowNode) => n.id === srcId);
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
        model: WorkflowService._resolveModel('sonnet'),
        folderPath: workspaceRoot,
        workflowId,
        nodeId,
        runId,
      });

      WorkflowModel.updateNodeStatus(workflowId, nodeId, 'completed', output);
      WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);

      logger.info(`Step execution completed for node ${nodeId} in workflow ${workflowId}`);
      return { nodeId, input: nodeInput, output };
    } catch (err: any) {
      WorkflowModel.updateNodeStatus(workflowId, nodeId, 'failed', `Error: ${err.message}`);
      WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);
      throw new AppError('EXECUTION_ERROR', `Step execution failed for node '${nodeId}': ${err.message}`, 500);
    }
  }

  /**
   * Simulate workflow execution with mock data, without calling real Claude CLI
   */
  static async simulate(workflowId: string, mockData: Record<string, any> = {}): Promise<SimulationResult> {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
    }

    const nodes: WorkflowNode[] = workflow.nodes;
    const edges: WorkflowEdge[] = workflow.edges;
    const nodeOutputs = new Map<string, string>();

    // Build adjacency and indegree
    const adjacency = new Map<string, string[]>();
    const indegree = new Map<string, number>();
    const nodeMap = new Map<string, WorkflowNode>();

    for (const node of nodes) {
      nodeMap.set(node.id, node);
      adjacency.set(node.id, []);
      indegree.set(node.id, 0);
    }

    for (const edge of edges) {
      const src = edge.source || edge.from || '';
      const tgt = edge.target || edge.to || '';
      if (src && tgt && adjacency.has(src) && indegree.has(tgt)) {
        adjacency.get(src)!.push(tgt);
        indegree.set(tgt, indegree.get(tgt)! + 1);
      }
    }

    // Initial queue: all nodes with indegree 0
    let queue: string[] = [];
    for (const [nodeId, deg] of indegree) {
      if (deg === 0) queue.push(nodeId);
    }

    const results: Record<string, string> = {};

    while (queue.length > 0) {
      for (const nodeId of queue) {
        const node = nodeMap.get(nodeId)!;

        // Use mock data if provided, otherwise simulate output
        if (mockData[nodeId] !== undefined) {
          const output = typeof mockData[nodeId] === 'string'
            ? mockData[nodeId]
            : JSON.stringify(mockData[nodeId]);
          nodeOutputs.set(nodeId, output);
          results[nodeId] = output;
        } else {
          // Simulate based on node type
          const simulatedOutput = WorkflowService._simulateNode(node, nodeOutputs, workflow);
          nodeOutputs.set(nodeId, simulatedOutput);
          results[nodeId] = simulatedOutput;
        }
      }

      // Build next layer
      const nextQueue: string[] = [];
      for (const nodeId of queue) {
        for (const targetId of adjacency.get(nodeId) || []) {
          const newDegree = indegree.get(targetId)! - 1;
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
  static _simulateNode(node: WorkflowNode, nodeOutputs: Map<string, string>, workflow: WorkflowData): string {
    switch (node.type) {
      case 'start':
        return workflow.context?.workflowInput
          ? (typeof workflow.context.workflowInput === 'string'
            ? workflow.context.workflowInput
            : JSON.stringify(workflow.context.workflowInput))
          : 'Simulation started';

      case 'end': {
        const upstreamOutputs: string[] = [];
        const directUpstream = (workflow?.edges || []).filter(e => (e.target || e.to) === node.id).map(e => e.source || e.from || '');
        for (const upId of directUpstream) {
          const out = nodeOutputs.get(upId);
          if (out) upstreamOutputs.push(out);
        }
        return upstreamOutputs.join('\n---\n') || 'Simulation completed';
      }

      case 'merge': {
        const mergeOutputs: string[] = [];
        const directUpstream = (workflow?.edges || []).filter(e => (e.target || e.to) === node.id).map(e => e.source || e.from || '');
        for (const upId of directUpstream) {
          const out = nodeOutputs.get(upId);
          if (out) mergeOutputs.push(out);
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
  static async testNode(workflowId: string, nodeId: string, testInput: any): Promise<StepResult> {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
    }

    const node = workflow.nodes.find((n: WorkflowNode) => n.id === nodeId);
    if (!node) {
      throw new AppError('NOT_FOUND', `Node with id '${nodeId}' not found in workflow '${workflowId}'`, 404);
    }

    const claudeService = WorkflowService._claudeService || (global as any).__claudeService;
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
        model: WorkflowService._resolveModel('sonnet'),
        folderPath: workspaceRoot,
        workflowId,
        nodeId,
        runId,
      });

      WorkflowModel.updateNodeStatus(workflowId, nodeId, 'completed', output);
      WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);

      logger.info(`Node test completed for node ${nodeId} in workflow ${workflowId}`);
      return { nodeId, input: nodeInput, output };
    } catch (err: any) {
      WorkflowModel.updateNodeStatus(workflowId, nodeId, 'failed', `Error: ${err.message}`);
      WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);
      throw new AppError('EXECUTION_ERROR', `Node test failed for '${nodeId}': ${err.message}`, 500);
    }
  }

  /**
   * Get all node outputs and shared context variables for a workflow
   */
  static getVariables(workflowId: string): VariablesResult {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
    }

    const nodes: VariablesResult['nodes'] = {};
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
  static async batchExecute(workflowId: string, paramsArray: Array<{ input: any; params?: Record<string, any> }>): Promise<BatchExecuteResult[]> {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
    }

    if (!Array.isArray(paramsArray) || paramsArray.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'paramsArray must be a non-empty array', 400);
    }

    const results: BatchExecuteResult[] = [];

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
      } catch (err: any) {
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
  static resumeFromCheckpoint(workflowId: string, checkpoint: { runId: string; workflowInput?: any }): ExecuteResult {
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
  static skipNodeAndContinue(workflowId: string, nodeId: string): ExecuteResult & { skippedNode: string } {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow '${workflowId}' not found`, 404);
    }

    const node = workflow.nodes?.find((n: WorkflowNode) => n.id === nodeId);
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
  static async _waitForMasterCompletion(workflowId: string, timeoutMs: number = 300000): Promise<void> {
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
  static async stop(id: string): Promise<void> {
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
  static _broadcastNodeUpdate(workflowId: string, runId: string, nodeId: string): void {
    const broadcastService = WorkflowService._broadcastService;
    if (!broadcastService) return;

    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) return;

    const node = workflow.nodes.find((n: WorkflowNode) => n.id === nodeId);
    if (!node) return;

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
  static _broadcastStatusUpdate(workflowId: string, status: string, runId: string, summary?: string): void {
    const broadcastService = WorkflowService._broadcastService;
    if (!broadcastService) return;

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
  static _calculateProgress(workflowId: string): number {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) return 0;
    const workNodes = workflow.nodes.filter((n: WorkflowNode) => n.type !== 'start' && n.type !== 'end');
    if (workNodes.length === 0) return 0;
    const completed = workNodes.filter((n: WorkflowNode) => n.status === 'completed').length;
    return Math.round((completed / workNodes.length) * 100);
  }

  /**
   * Pause workflow
   */
  static pause(id: string): { status: string } {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }
    if (workflow.executionStatus !== 'running') {
      throw new AppError('CONFLICT', '只能暂停运行中的工作流', 409);
    }

    // Abort the SDK loop immediately (finishes current API call, then stops)
    const sdkService = (global as any).__sdkService;
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
  static resume(id: string): { status: string } {
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
  static getStatus(id: string): { status: string; currentNodeId: string | null; progress: number; runId: string | null } {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }

    const latestRun = workflow.executionLog.length > 0
      ? workflow.executionLog[workflow.executionLog.length - 1]
      : null;

    let progress = 0;
    let currentNodeId: string | null = null;

    if (latestRun && latestRun.nodeResults.length > 0) {
      const workResults = latestRun.nodeResults.filter((nr: NodeResult) => {
        const n = workflow.nodes.find((nd: WorkflowNode) => nd.id === nr.nodeId);
        return n && n.type !== 'start' && n.type !== 'end';
      });
      progress = workResults.length > 0
        ? Math.round((workResults.filter((n: NodeResult) => n.status === 'completed').length / workResults.length) * 100)
        : 0;
      const runningNode = latestRun.nodeResults.find((n: NodeResult) => n.status === 'running');
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
  static setFolder(id: string, folderPath: string): WorkflowData {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }

    // Validate folderPath is a non-empty string
    if (!folderPath || typeof folderPath !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'folderPath must be a non-empty string', 400);
    }

    const fs = require('fs');
    const resolved = path.resolve(folderPath);
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
  static clearFolder(id: string): WorkflowData {
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
  static getExecutionStatus(id: string): ExecutionStatusResult {
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
        nodes: workflow.nodes.map((n: WorkflowNode) => ({
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
        edges: (workflow.edges || []).map((e: WorkflowEdge) => ({
          source: e.source || e.from || '',
          target: e.target || e.to || ''
        }))
      };
    }

    const latestRun = workflow.executionLog.find((e: ExecutionLogEntry) => e.runId === workflow.currentRunId)
      || workflow.executionLog[workflow.executionLog.length - 1];

    if (!latestRun) {
      return {
        workflowId: id,
        runId: null,
        status: 'idle',
        startedAt: null,
        completedAt: null,
        progress: 0,
        nodes: workflow.nodes.map((n: WorkflowNode) => ({
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
        edges: (workflow.edges || []).map((e: WorkflowEdge) => ({
          source: e.source || e.from || '',
          target: e.target || e.to || ''
        }))
      };
    }

    const workNodes = workflow.nodes.filter((n: WorkflowNode) => n.type !== 'start' && n.type !== 'end');
    const completedCount = workNodes.filter((n: WorkflowNode) => n.status === 'completed').length;
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
      nodes: workflow.nodes.map((n: WorkflowNode) => ({
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
      edges: (workflow.edges || []).map((e: WorkflowEdge) => ({
        source: e.source || e.from || '',
        target: e.target || e.to || ''
      }))
    };
  }
}

// 使用 CommonJS 导出以保持与现有路由的兼容性
module.exports = WorkflowService;
module.exports.WorkflowService = WorkflowService;
module.exports.default = WorkflowService;
