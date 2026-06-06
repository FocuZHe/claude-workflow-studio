/**
 * TaskService - 任务业务逻辑服务
 * 管理任务的创建、执行、状态流转和生命周期
 */

// JS 模块使用 require 导入（尚未转换为 TS）
const TaskModel = require('../models/Task');
const AgentModel = require('../models/Agent');
const WorkflowModel = require('../models/Workflow');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const SelfRepair = require('../utils/SelfRepair');

import type { BroadcastService } from './BroadcastService';
import type { ClaudeService, ClaudeServiceConfig } from './ClaudeService';

// ============= 类型定义 =============

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

interface TaskLog {
  timestamp: Date;
  level: string;
  message: string;
}

interface TaskData {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: string;
  assignedAgentId: string | null;
  workflowId: string | null;
  workflowNodeId: string | null;
  workflowRunId: string | null;
  folderPath: string | null;
  queueId: string | null;
  queueItemId: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  workflowName: string | null;
  input: string;
  output: string;
  logs: TaskLog[];
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  [key: string]: any;
}

interface TaskCreateData {
  title?: string;
  description?: string;
  assignedAgentId?: string | null;
  workflowId?: string | null;
  folderPath?: string | null;
  workspaceId?: string | null;
  workspaceName?: string | null;
  workflowName?: string | null;
  input?: string;
  autoExecute?: boolean;
  queueId?: string | null;
  queueItemId?: string | null;
  timeoutMs?: number;  // 任务超时时间（毫秒），默认30分钟
  [key: string]: any;
}

interface TaskUpdateData {
  title?: string;
  description?: string;
  status?: TaskStatus;
  assignedAgentId?: string | null;
  workflowId?: string | null;
  folderPath?: string | null;
  input?: string;
  output?: string;
  startedAt?: Date;
  completedAt?: Date;
  workflowRunId?: string;
  [key: string]: any;
}

interface TaskFilters {
  status?: TaskStatus;
  priority?: string;
  assignedAgentId?: string;
  workflowId?: string;
  page?: number;
  limit?: number;
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

interface AgentData {
  id: string;
  name: string;
  status: string;
  config: {
    systemPrompt?: string;
    model?: string;
    [key: string]: any;
  };
  folderPath?: string;
  [key: string]: any;
}

interface WorkflowData {
  id: string;
  name?: string;
  executionStatus: string;
  nodes: WorkflowNodeData[];
  executionLog: ExecutionLogEntry[];
  [key: string]: any;
}

interface WorkflowNodeData {
  id: string;
  type: string;
  status?: string;
  [key: string]: any;
}

interface ExecutionLogEntry {
  runId: string;
  nodeResults?: NodeResult[];
  [key: string]: any;
}

interface NodeResult {
  nodeId: string;
  output?: string;
  [key: string]: any;
}

interface AgentConfig {
  systemPrompt: string;
  model: string;
  folderPath: string | null;
  runId?: string;
  nodeId?: string;
}

// ============= TaskService 类 =============

/**
 * Task business logic service
 */
class TaskService {
  static _broadcastService: BroadcastService | null = null;
  static _claudeService: ClaudeService | null = null;
  static _cancelledTasks: Set<string> = new Set();
  static _pollingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  /**
   * 初始化 TaskService 的依赖注入
   */
  static init(broadcastService: BroadcastService, claudeService?: ClaudeService): void {
    TaskService._broadcastService = broadcastService;
    TaskService._claudeService = claudeService || null;
  }

  /**
   * Create a new task
   */
  static create(data: TaskCreateData): TaskData {
    // Validate assigned agent exists
    if (data.assignedAgentId && !AgentModel.exists(data.assignedAgentId)) {
      throw new AppError('VALIDATION_ERROR', `Agent '${data.assignedAgentId}' does not exist`, 400, [
        { field: 'assignedAgentId', message: `Agent '${data.assignedAgentId}' does not exist` }
      ]);
    }

    // Inherit folderPath from workflow if not explicitly provided
    if (data.workflowId && !data.folderPath) {
      const workflow = WorkflowModel.findById(data.workflowId);
      if (workflow && workflow.folderPath) {
        data.folderPath = workflow.folderPath;
      }
    }

    // Snapshot workspace/workflow names for display resilience
    if (data.workspaceId && !data.workspaceName) {
      try {
        const WorkspaceManager = require('./WorkspaceManager');
        const ws = WorkspaceManager.getById(data.workspaceId);
        if (ws) data.workspaceName = ws.name || ws.path?.split(/[\\/]/).pop() || '';
      } catch (e) { /* ignore */ }
    }
    if (data.workflowId && !data.workflowName) {
      const wf = WorkflowModel.findById(data.workflowId);
      if (wf) data.workflowName = wf.name || '';
    }

    const task: TaskData = TaskModel.create(data);
    logger.info(`Task created: ${task.id}`, { title: task.title });

    // 创建后立即执行：等待当前任务完成后立刻接上
    if (data.autoExecute) {
      TaskModel.update(task.id, { status: 'pending' });
      TaskModel.addLog(task.id, 'info', '任务已加入插队队列');
      TaskService._broadcastProgress(task.id, 'pending', '等待当前任务完成后立即执行');
      // 后台等待 + 执行
      TaskService._executeWhenReady(task.id).catch((err: Error) => {
        logger.error(`Auto-execute task ${task.id} failed: ${err.message}`);
      });
    }

    return task;
  }

  /**
   * List tasks
   */
  static list(filters: TaskFilters): PaginatedResult<TaskData> {
    return TaskModel.findAll(filters);
  }

  /**
   * Get task by ID
   */
  static getById(id: string): TaskData {
    const task: TaskData | null = TaskModel.findById(id);
    if (!task) {
      throw new AppError('NOT_FOUND', `Task with id '${id}' not found`, 404);
    }
    return task;
  }

  /**
   * Update task
   */
  static update(id: string, data: TaskUpdateData): TaskData {
    // Validate assigned agent if changing
    if (data.assignedAgentId && !AgentModel.exists(data.assignedAgentId)) {
      throw new AppError('VALIDATION_ERROR', `Agent '${data.assignedAgentId}' does not exist`, 400, [
        { field: 'assignedAgentId', message: `Agent '${data.assignedAgentId}' does not exist` }
      ]);
    }

    const result = TaskModel.update(id, data);
    if (!result) {
      throw new AppError('NOT_FOUND', `Task with id '${id}' not found`, 404);
    }
    if (result.error) {
      throw new AppError('VALIDATION_ERROR', result.error, 400);
    }

    logger.info(`Task updated: ${id}`);
    return result;
  }

  /**
   * Delete task
   */
  static delete(id: string): boolean {
    const task: TaskData | null = TaskModel.findById(id);
    if (!task) {
      throw new AppError('NOT_FOUND', `Task with id '${id}' not found`, 404);
    }
    if (task.status === 'running') {
      throw new AppError('CONFLICT', '不能删除正在运行的任务', 409);
    }

    TaskModel.delete(id);
    logger.info(`Task deleted: ${id}`);
    return true;
  }

  /**
   * Execute task — 更新状态为 running 后在后台异步执行，API 立即返回
   */
  static async execute(id: string): Promise<{ status: TaskStatus }> {
    const task: TaskData | null = TaskModel.findById(id);
    if (!task) {
      throw new AppError('NOT_FOUND', `Task with id '${id}' not found`, 404);
    }

    // 检查关联的工作区是否仍然活跃
    if (task.workspaceId) {
      const WorkspaceManager = require('./WorkspaceManager');
      const ws = WorkspaceManager.getById(task.workspaceId);
      if (!ws) {
        throw new AppError('CONFLICT', '该任务关联的工作区已停用，请先重新激活工作区后再执行', 409);
      }
    }

    // 检查关联的工作流是否存在
    if (task.workflowId) {
      const WfModel = require('../models/Workflow');
      const wf = WfModel.findById(task.workflowId);
      if (!wf) {
        throw new AppError('NOT_FOUND', '该任务关联的工作流已不存在，可能所属工作区已停用', 404);
      }
    }

    // 状态校验
    if (!TaskModel.isValidTransition(task.status, 'running')) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Cannot execute task in '${task.status}' status`,
        400
      );
    }

    // 清除旧的取消状态（防止重新执行时被误判为已取消）
    TaskService._cancelledTasks.delete(id);
    const oldInterval = TaskService._pollingIntervals.get(id);
    if (oldInterval) {
      clearInterval(oldInterval);
      TaskService._pollingIntervals.delete(id);
    }

    // 更新状态为 running
    const updated = TaskModel.update(id, { status: 'running', startedAt: new Date() });
    if (updated.error) {
      throw new AppError('VALIDATION_ERROR', updated.error, 400);
    }

    TaskModel.addLog(id, 'info', '任务开始执行');

    // 广播任务进度
    TaskService._broadcastProgress(id, 'running', '任务开始执行');

    // 更新 Agent 状态为忙碌
    if (task.assignedAgentId) {
      AgentModel.update(task.assignedAgentId, { status: 'busy' });
      AgentModel.addLog(task.assignedAgentId, 'info', `Executing task: ${task.title}`);
      TaskService._broadcastAgentStatusUpdate(task.assignedAgentId, 'busy');
    }

    // 后台异步执行（不 await，让 API 立即返回）
    try {
      TaskService._executeInBackground(id).catch((err: Error) => {
        logger.error(`Task execution error: ${id}`, { error: err.message });
        try { TaskService.fail(id, err.message); } catch (e) { /* task may have been deleted */ }
      });
    } catch (err: any) {
      // Handle synchronous errors (e.g. before async part begins)
      logger.error(`Task execution sync error: ${id}`, { error: err.message });
      TaskService.fail(id, err.message);
    }

    logger.info(`Task execution started: ${id}`);
    return { status: 'running' };
  }

  /**
   * 等工作流空闲后立即执行（插队不中断）
   */
  static async _executeWhenReady(taskId: string): Promise<void> {
    const task: TaskData | null = TaskModel.findById(taskId);
    if (!task || !task.workflowId) {
      // No workflow? Just execute immediately
      return TaskService._executeInBackground(taskId);
    }

    // Poll workflow until idle
    const maxWait: number = 600000; // 10 min max
    const start: number = Date.now();
    while (Date.now() - start < maxWait) {
      const wf: WorkflowData | null = WorkflowModel.findById(task.workflowId);
      if (!wf || wf.executionStatus !== 'running') break;
      await new Promise<void>(r => setTimeout(r, 2000));
    }

    TaskModel.update(taskId, { status: 'running', startedAt: new Date() });
    TaskModel.addLog(taskId, 'info', '插队任务开始执行');
    TaskService._broadcastProgress(taskId, 'running', '插队执行中');
    return TaskService._executeInBackground(taskId);
  }

  /**
   * 后台执行任务的核心逻辑
   * 根据任务配置决定通过工作流或 Agent 执行
   */
  static async _executeInBackground(taskId: string): Promise<void> {
    const task: TaskData | null = TaskModel.findById(taskId);
    if (!task) return;

    try {
      let output: string;

      if (task.workflowId) {
        // 有关联工作流 → 触发工作流执行
        output = await TaskService._executeViaWorkflow(task);
      } else if (task.assignedAgentId) {
        // 有分配的 Agent → 直接调用 ClaudeService
        output = await TaskService._executeViaAgent(task);
      } else {
        // 没有工作流也没有 Agent → 标记为完成（手动任务）
        output = '任务已创建，等待手动处理';
      }

      // If the task was cancelled during execution, don't overwrite the status
      if (TaskService._cancelledTasks.has(taskId)) {
        TaskService._cancelledTasks.delete(taskId);
        return;
      }

      // 标记任务完成
      TaskService.complete(taskId, output);

    } catch (err: any) {
      // If the task was cancelled during execution, don't overwrite the status
      if (TaskService._cancelledTasks.has(taskId)) {
        TaskService._cancelledTasks.delete(taskId);
        return;
      }
      TaskService.fail(taskId, err.message);
    }
  }

  /**
   * 通过工作流执行任务
   */
  static async _executeViaWorkflow(task: TaskData): Promise<string> {
    const WorkflowService = require('./WorkflowService');

    TaskModel.addLog(task.id, 'info', `触发工作流执行: ${task.workflowId}`);
    TaskService._broadcastProgress(task.id, 'running', '正在执行关联工作流...');

    // 触发工作流执行
    const { runId } = WorkflowService.execute(task.workflowId, task.input, { taskId: task.id });

    // 保存 runId 到任务，用于追踪
    TaskModel.update(task.id, { workflowRunId: runId });
    TaskModel.addLog(task.id, 'info', `工作流已启动，runId: ${runId}`);

    // 轮询等待工作流完成（最多 10 分钟）
    const result: string = await TaskService._waitForWorkflowCompletion(task.id, task.workflowId || '', runId, 600000);
    return result;
  }

  /**
   * 直接通过 Agent（ClaudeService）执行任务（含自修复重试）
   */
  static async _executeViaAgent(task: TaskData): Promise<string> {
    const claudeService = TaskService._claudeService;
    if (!claudeService) {
      throw new Error('ClaudeService 未初始化');
    }

    const agent: AgentData | null = AgentModel.findById(task.assignedAgentId);
    const agentConfig: AgentConfig = {
      systemPrompt: agent?.config?.systemPrompt || '',
      model: agent?.config?.model || 'deepseek-v4-pro',
      folderPath: task.folderPath || agent?.folderPath || null,
    };

    TaskModel.addLog(task.id, 'info', `通过 Agent "${agent?.name || task.assignedAgentId}" 执行`);
    TaskService._broadcastProgress(task.id, 'running', `Agent "${agent?.name || ''}" 正在执行...`);

    const taskRunId: string = `task_${task.id}`;
    agentConfig.runId = taskRunId;
    agentConfig.nodeId = undefined;

    // Self-repair retry loop — same logic as WorkflowService._executeNode
    let modifiedInput: string = task.input;
    let currentModel: string = agentConfig.model;
    let fallbackModel: string | null = null;
    const totalAttempts: number = SelfRepair.SELF_REPAIR_MAX; // 3 self-repair attempts
    let lastError: any = null;
    let sameErrorCount: number = 0;

    for (let attempt = 0; attempt <= totalAttempts; attempt++) {
      try {
        if (attempt > 0) {
          const delay: number = SelfRepair.getAdaptiveDelay(lastError, attempt, 1000);
          logger.info(`Task ${task.id} retry ${attempt}/${totalAttempts} (delay ${delay}ms)`, { errorType: lastError?.errorType });
          TaskModel.addLog(task.id, 'warn', `重试 ${attempt}/${totalAttempts} — ${SelfRepair.getSelfRepairHint(lastError)}`);
          TaskService._broadcastProgress(task.id, 'running', `重试中 (${attempt}/${totalAttempts})...`);
          await new Promise<void>(resolve => setTimeout(resolve, delay));

          // Self-repair: truncate input for context-too-long
          if (lastError?.errorType === 'CONTEXT_TOO_LONG') {
            const truncated: string = SelfRepair.truncateInput(modifiedInput, 0.7);
            if (truncated !== modifiedInput) {
              modifiedInput = truncated;
              TaskModel.addLog(task.id, 'info', '自我修复：自动缩短输入内容');
            }
          }

          // Self-repair: switch to fallback model for token/overloaded errors
          if ((lastError?.errorType === 'TOKEN_EXHAUSTED' || lastError?.errorType === 'SERVICE_OVERLOADED')) {
            if (!fallbackModel) {
              fallbackModel = SelfRepair.getFallbackModel(currentModel);
              currentModel = fallbackModel || currentModel;
              TaskModel.addLog(task.id, 'info', `自我修复：切换到备用模型 ${fallbackModel}`);
              TaskService._broadcastProgress(task.id, 'running', `已切换至备用模型 ${fallbackModel}...`);
            }
          }
        }

        const config: ClaudeServiceConfig = {
          ...agentConfig,
          model: currentModel,
          folderPath: agentConfig.folderPath || undefined,
          timeoutMs: task.timeoutMs || 30 * 60 * 1000,  // 使用任务配置的超时时间（默认30分钟）
        };
        const output: string = await claudeService.execute(taskRunId, task.assignedAgentId || null, modifiedInput, config);
        return output;

      } catch (err: any) {
        // Track consecutive identical failures
        if (lastError && lastError.errorType === err.errorType && lastError.message === err.message) {
          sameErrorCount++;
        } else {
          sameErrorCount = 1;
        }
        lastError = err;

        // After fallback model also fails, no point retrying
        if (fallbackModel && (err.errorType === 'TOKEN_EXHAUSTED' || err.errorType === 'SERVICE_OVERLOADED')) {
          logger.warn(`Task ${task.id}: fallback model ${fallbackModel} also failed, aborting retry`);
          throw err;
        }

        // Hard stops — won't be fixed by retrying
        if (SelfRepair.isNonRetryable(err)) throw err;
        if (SelfRepair.shouldStopRetry(err, sameErrorCount)) {
          logger.warn(`Task ${task.id}: ${err.errorType} repeated ${sameErrorCount}x, aborting retry`);
          throw err;
        }
        if (attempt >= totalAttempts) throw err;

        logger.warn(`Task ${task.id} failed (attempt ${attempt + 1}/${totalAttempts + 1}): ${err.message}`, { errorType: err.errorType });
      }
    }

    throw lastError || new Error('Task execution failed');
  }

  /**
   * 轮询等待工作流完成
   */
  static _waitForWorkflowCompletion(taskId: string, workflowId: string, runId: string, timeoutMs: number = 600000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const startTime: number = Date.now();
      const checkInterval: ReturnType<typeof setInterval> = setInterval(() => {
        try {
          // Check if the task was cancelled
          if (TaskService._cancelledTasks.has(taskId)) {
            clearInterval(checkInterval);
            TaskService._pollingIntervals.delete(taskId);
            TaskService._cancelledTasks.delete(taskId);
            reject(new Error('任务已取消'));
            return;
          }

          const workflow: WorkflowData | null = WorkflowModel.findById(workflowId);
          if (!workflow) {
            clearInterval(checkInterval);
            TaskService._pollingIntervals.delete(taskId);
            reject(new Error('关联工作流不存在'));
            return;
          }

          // 检查是否超时
          if (Date.now() - startTime > timeoutMs) {
            clearInterval(checkInterval);
            TaskService._pollingIntervals.delete(taskId);
            reject(new Error('工作流执行超时'));
            return;
          }

          // 检查工作流执行状态
          if (workflow.executionStatus === 'completed') {
            clearInterval(checkInterval);
            TaskService._pollingIntervals.delete(taskId);
            // 获取最终输出
            const execLog = workflow.executionLog.find((e: ExecutionLogEntry) => e.runId === runId);
            const endResult = execLog?.nodeResults?.filter((nr: NodeResult) => {
              const node = workflow.nodes.find((n: WorkflowNodeData) => n.id === nr.nodeId);
              return node && node.type === 'end';
            });
            const output: string = endResult && endResult.length > 0
              ? endResult[endResult.length - 1].output || '工作流执行完成'
              : '工作流执行完成';

            // 广播进度
            TaskService._broadcastProgress(taskId, 'running', '工作流执行完成');
            resolve(output);
          } else if (workflow.executionStatus === 'failed') {
            clearInterval(checkInterval);
            TaskService._pollingIntervals.delete(taskId);
            reject(new Error('工作流执行失败'));
          } else if (workflow.executionStatus === 'stopped') {
            clearInterval(checkInterval);
            TaskService._pollingIntervals.delete(taskId);
            reject(new Error('工作流已停止'));
          } else if (workflow.executionStatus === 'paused') {
            // Workflow is paused — update task status accordingly
            const currentTask: TaskData | null = TaskModel.findById(taskId);
            if (currentTask && currentTask.status !== 'paused') {
              TaskModel.update(taskId, { status: 'paused' });
              TaskService._broadcastProgress(taskId, 'paused', '工作流已暂停');
            }
          }

          // 还在运行中，广播进度
          const progress: number = workflow.nodes.filter((n: WorkflowNodeData) => n.status === 'completed').length;
          const total: number = workflow.nodes.length;
          TaskService._broadcastProgress(taskId, 'running', `工作流进度: ${progress}/${total} 节点`);

        } catch (err: any) {
          clearInterval(checkInterval);
          TaskService._pollingIntervals.delete(taskId);
          reject(err);
        }
      }, 2000); // 每 2 秒检查一次

      // Store the interval reference for cancellation
      TaskService._pollingIntervals.set(taskId, checkInterval);
    });
  }

  /**
   * 广播 Agent 状态变更到所有 WebSocket 客户端
   */
  static _broadcastAgentStatusUpdate(agentId: string, status: string): void {
    if (TaskService._broadcastService) {
      const agent: AgentData | null = AgentModel.findById(agentId);
      TaskService._broadcastService.broadcast('agent.statusUpdate', {
        agentId,
        status,
        agent
      });
    }
  }

  /**
   * 广播任务进度到所有 WebSocket 客户端
   */
  static _broadcastProgress(taskId: string, status: string, message: string): void {
    if (TaskService._broadcastService) {
      const task: TaskData | null = TaskModel.findById(taskId);
      TaskService._broadcastService.broadcast('task.progress', {
        taskId,
        taskName: task?.title || '',
        status,
        message,
        progress: task?.workflowId ? 'workflow' : 'agent'
      });
    }
  }

  /**
   * Cancel task
   */
  static cancel(id: string): { status: TaskStatus } {
    const task: TaskData | null = TaskModel.findById(id);
    if (!task) {
      throw new AppError('NOT_FOUND', `Task with id '${id}' not found`, 404);
    }

    if (!TaskModel.isValidTransition(task.status, 'cancelled')) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Cannot cancel task in '${task.status}' status`,
        400
      );
    }

    const updated = TaskModel.update(id, { status: 'cancelled' });
    if (updated.error) {
      throw new AppError('VALIDATION_ERROR', updated.error, 400);
    }

    TaskModel.addLog(id, 'info', 'Task cancelled');

    this._broadcastProgress(id, 'cancelled', '任务已取消');

    // Cancel the Claude CLI process if running
    // The process is registered under 'task_<id>' in ClaudeService (see _executeViaAgent)
    if (TaskService._claudeService) {
      TaskService._claudeService.cancel(`task_${id}`);
    }

    // Stop polling for this task
    TaskService._cancelledTasks.add(id);
    const pollingInterval = TaskService._pollingIntervals.get(id);
    if (pollingInterval) {
      clearInterval(pollingInterval);
      TaskService._pollingIntervals.delete(id);
    }

    // Update assigned agent status - only if no other running tasks
    if (task.assignedAgentId) {
      const hasOtherRunningTasks: boolean = TaskModel.findAll({ status: 'running', assignedAgentId: task.assignedAgentId, page: 1, limit: 1 })
        .items.some((t: TaskData) => t.id !== id);
      if (!hasOtherRunningTasks) {
        AgentModel.update(task.assignedAgentId, { status: 'idle' });
        TaskService._broadcastAgentStatusUpdate(task.assignedAgentId, 'idle');
      }
    }

    logger.info(`Task cancelled: ${id}`);
    return { status: 'cancelled' };
  }

  static pause(id: string): { status: TaskStatus } {
    const task: TaskData | null = TaskModel.findById(id);
    if (!task) throw new AppError('NOT_FOUND', `Task with id '${id}' not found`, 404);

    TaskModel.update(id, { status: 'paused' });
    TaskModel.addLog(id, 'info', 'Task paused');

    // Pause the underlying workflow
    if (task.workflowId) {
      try {
        const WorkflowService = require('./WorkflowService');
        WorkflowService.pause(task.workflowId);
      } catch (e: any) { logger.warn(`Failed to pause workflow: ${e.message}`); }
    }

    this._broadcastProgress(id, 'paused', '任务已暂停');
    logger.info(`Task paused: ${id}`);
    return { status: 'paused' };
  }

  static resume(id: string): { status: TaskStatus } {
    const task: TaskData | null = TaskModel.findById(id);
    if (!task) throw new AppError('NOT_FOUND', `Task with id '${id}' not found`, 404);
    if (task.status !== 'paused') throw new AppError('VALIDATION_ERROR', '只能恢复已暂停的任务', 400);

    TaskModel.update(id, { status: 'running' });
    TaskModel.addLog(id, 'info', 'Task resumed');

    // Resume the underlying workflow
    if (task.workflowId) {
      try {
        const WorkflowService = require('./WorkflowService');
        WorkflowService.resume(task.workflowId);
      } catch (e: any) { logger.warn(`Failed to resume workflow: ${e.message}`); }
    }

    this._broadcastProgress(id, 'running', '任务已恢复');
    logger.info(`Task resumed: ${id}`);
    return { status: 'running' };
  }

  /**
   * Complete task
   */
  static complete(id: string, output: string): TaskData {
    const task: TaskData | null = TaskModel.findById(id);
    if (!task) {
      throw new AppError('NOT_FOUND', `Task with id '${id}' not found`, 404);
    }

    const updated = TaskModel.update(id, { status: 'completed', output });
    if (updated.error) {
      throw new AppError('VALIDATION_ERROR', updated.error, 400);
    }

    TaskModel.addLog(id, 'info', 'Task completed');

    // Only set agent to idle if no other tasks are running for this agent
    if (task.assignedAgentId) {
      const hasOtherRunningTasks: boolean = TaskModel.findAll({ status: 'running', assignedAgentId: task.assignedAgentId, page: 1, limit: 1 })
        .items.some((t: TaskData) => t.id !== id);
      if (!hasOtherRunningTasks) {
        AgentModel.update(task.assignedAgentId, { status: 'idle' });
        TaskService._broadcastAgentStatusUpdate(task.assignedAgentId, 'idle');
      }
    }

    // 广播任务进度（完成状态）
    TaskService._broadcastProgress(id, 'completed', '任务已完成');

    // 广播任务完成事件
    if (TaskService._broadcastService) {
      TaskService._broadcastService.broadcast('task.completed', {
        taskId: id,
        taskName: task.title,
        status: 'completed',
        output
      });
    }

    logger.info(`Task completed: ${id}`);

    // Queue notification
    if (task.queueId) {
      try {
        const TaskQueueService = require('./TaskQueueService');
        TaskQueueService._onTaskComplete(task.queueId, task.queueItemId, id, output);
      } catch (e: any) {
        logger.error(`Queue notification failed: ${e.message}`);
      }
    }

    return updated;
  }

  /**
   * Fail task
   */
  static fail(id: string, errorMessage: string): TaskData {
    const task: TaskData | null = TaskModel.findById(id);
    if (!task) {
      throw new AppError('NOT_FOUND', `Task with id '${id}' not found`, 404);
    }

    const updated = TaskModel.update(id, { status: 'failed', output: errorMessage });
    if (updated.error) {
      throw new AppError('VALIDATION_ERROR', updated.error, 400);
    }

    TaskModel.addLog(id, 'error', `Task failed: ${errorMessage}`);

    // Only set agent to error if no other tasks are running for this agent
    if (task.assignedAgentId) {
      const hasOtherRunningTasks: boolean = TaskModel.findAll({ status: 'running', assignedAgentId: task.assignedAgentId, page: 1, limit: 1 })
        .items.some((t: TaskData) => t.id !== id);
      if (!hasOtherRunningTasks) {
        AgentModel.update(task.assignedAgentId, { status: 'error' });
        TaskService._broadcastAgentStatusUpdate(task.assignedAgentId, 'error');
      }
      AgentModel.addLog(task.assignedAgentId, 'error', `Task failed: ${task.title}`);
    }

    // 广播任务进度（失败状态）
    TaskService._broadcastProgress(id, 'failed', errorMessage);

    // 广播任务失败事件
    if (TaskService._broadcastService) {
      TaskService._broadcastService.broadcast('task.failed', {
        taskId: id,
        taskName: task.title,
        status: 'failed',
        error: errorMessage
      });
    }

    logger.error(`Task failed: ${id}`, { error: errorMessage });

    // Queue notification
    if (task.queueId) {
      try {
        const TaskQueueService = require('./TaskQueueService');
        TaskQueueService._onTaskFail(task.queueId, task.queueItemId, id, errorMessage);
      } catch (e: any) {
        logger.error(`Queue notification failed: ${e.message}`);
      }
    }

    return updated;
  }
}

// 使用 CommonJS 导出以保持与现有路由的兼容性
module.exports = TaskService;
module.exports.TaskService = TaskService;
module.exports.default = TaskService;
