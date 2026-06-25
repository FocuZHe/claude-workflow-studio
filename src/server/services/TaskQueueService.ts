/**
 * TaskQueueService - 任务队列服务
 * 管理异步任务队列，支持顺序执行、暂停/恢复、错误处理
 * 存储委托给 TaskQueueModel（单一数据源，避免与 Model 状态不同步）
 */

const logger = require('../utils/logger');
const TaskQueueModel = require('../models/TaskQueue');
const { AppError } = require('../middleware/errorHandler');

export interface Task {
  id: string;
  type: string;
  data: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskQueue {
  id: string;
  name: string;
  description?: string;
  workflowId: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  items: any[];
  currentItemIndex: number;
  autoStopOnError: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class TaskQueueService {
  private static tasks: Map<string, Task> = new Map();
  private static _broadcastService: any = null;
  private static _runningQueues: Map<string, boolean> = new Map();

  /**
   * 初始化广播服务
   */
  static init(broadcastService: any): void {
    TaskQueueService._broadcastService = broadcastService;
  }

  /**
   * 重置卡住的任务（启动时恢复）
   * running 任务重置为 pending；running/paused 队列重置为 failed（启动前未完成的视为失败）
   *   注：running→pending / paused→pending 在状态机中非法，故重置为 failed
   */
  static resetStuckQueues(): void {
    // 重置 running 任务为 pending
    for (const task of this.tasks.values()) {
      if (task.status === 'running') {
        task.status = 'pending';
        task.updatedAt = new Date();
      }
    }
    // 重置 running/paused 队列为 failed
    try {
      const all = TaskQueueModel.findAll({ limit: 10000 });
      for (const q of all.items) {
        if (q.status === 'running' || q.status === 'paused') {
          TaskQueueModel.update(q.id, { status: 'failed' });
        }
      }
    } catch (e: any) {
      logger.warn(`resetStuckQueues: ${e.message}`);
    }
  }

  /**
   * 广播队列状态变化
   */
  static _broadcastQueueUpdate(queueId: string, event: string, data: any = {}): void {
    if (!TaskQueueService._broadcastService) return;
    TaskQueueService._broadcastService.broadcast(`queue.${event}`, {
      queueId,
      ...data,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 添加任务
   */
  static addTask(type: string, data: any): Task {
    const task: Task = {
      id: Math.random().toString(36).substring(7),
      type,
      data,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * 获取任务
   */
  static getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 更新任务状态
   */
  static updateTaskStatus(
    taskId: string,
    status: Task['status'],
    result?: any,
    error?: string
  ): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    task.status = status;
    task.result = result;
    task.error = error;
    task.updatedAt = new Date();

    return task;
  }

  /**
   * 获取所有任务
   */
  static getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 创建任务队列（委托 TaskQueueModel）
   */
  static create(data: any): any {
    return TaskQueueModel.create(data);
  }

  /**
   * 列出任务队列（委托 TaskQueueModel）
   */
  static list(params: { status?: string; workflowId?: string; page?: string; limit?: string }): { items: any[]; total: number; page: number; limit: number } {
    return TaskQueueModel.findAll({
      status: params.status,
      workflowId: params.workflowId,
      page: parseInt(params.page || '1') || 1,
      limit: parseInt(params.limit || '20') || 20
    });
  }

  /**
   * 获取单个任务队列（委托 TaskQueueModel，null 抛 404）
   */
  static getById(id: string): any {
    const queue = TaskQueueModel.findById(id);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Queue '${id}' not found`, 404);
    }
    return queue;
  }

  /**
   * 更新任务队列元数据（委托 TaskQueueModel）
   */
  static update(id: string, data: any): any {
    const queue = TaskQueueModel.findById(id);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Queue '${id}' not found`, 404);
    }
    const result = TaskQueueModel.update(id, data);
    if (result && result.error) {
      throw new AppError('VALIDATION_ERROR', result.error, 400);
    }
    return result;
  }

  /**
   * 删除任务队列（running 队列抛 409）
   */
  static delete(id: string): void {
    const queue = TaskQueueModel.findById(id);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Queue '${id}' not found`, 404);
    }
    if (queue.status === 'running') {
      throw new AppError('CONFLICT', `Cannot delete running queue`, 409);
    }
    TaskQueueModel.delete(id);
    this._runningQueues.delete(id);
  }

  /**
   * 开始执行队列
   */
  static async start(id: string): Promise<any> {
    const queue = TaskQueueModel.findById(id);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Queue '${id}' not found`, 404);
    }
    if (queue.status === 'running') {
      throw new AppError('VALIDATION_ERROR', 'Queue is already running', 400);
    }

    const result = TaskQueueModel.update(id, { status: 'running', currentItemIndex: 0 });
    if (result && result.error) {
      throw new AppError('VALIDATION_ERROR', result.error, 400);
    }

    this._runningQueues.set(id, true);
    this._broadcastQueueUpdate(id, 'started', { name: queue.name });

    // 异步执行队列
    this._executeQueue(id).catch(err => {
      logger.error(`Queue ${id} execution error:`, err);
    });

    return TaskQueueModel.findById(id);
  }

  /**
   * 暂停队列
   */
  static pause(id: string): any {
    const queue = TaskQueueModel.findById(id);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Queue '${id}' not found`, 404);
    }
    if (queue.status !== 'running') {
      throw new AppError('VALIDATION_ERROR', 'Queue is not running', 400);
    }

    const result = TaskQueueModel.update(id, { status: 'paused' });
    if (result && result.error) {
      throw new AppError('VALIDATION_ERROR', result.error, 400);
    }

    this._runningQueues.set(id, false);
    this._broadcastQueueUpdate(id, 'paused', { name: queue.name });
    return TaskQueueModel.findById(id);
  }

  /**
   * 恢复队列
   */
  static async resume(id: string): Promise<any> {
    const queue = TaskQueueModel.findById(id);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Queue '${id}' not found`, 404);
    }
    if (queue.status !== 'paused') {
      throw new AppError('VALIDATION_ERROR', 'Queue is not paused', 400);
    }

    const result = TaskQueueModel.update(id, { status: 'running' });
    if (result && result.error) {
      throw new AppError('VALIDATION_ERROR', result.error, 400);
    }

    this._runningQueues.set(id, true);
    this._broadcastQueueUpdate(id, 'resumed', { name: queue.name });

    // 继续执行队列
    this._executeQueue(id).catch(err => {
      logger.error(`Queue ${id} execution error:`, err);
    });

    return TaskQueueModel.findById(id);
  }

  /**
   * 取消队列
   */
  static cancel(id: string): any {
    const queue = TaskQueueModel.findById(id);
    if (!queue) {
      throw new AppError('NOT_FOUND', `Queue '${id}' not found`, 404);
    }
    if (queue.status === 'completed' || queue.status === 'cancelled') {
      throw new AppError('VALIDATION_ERROR', 'Queue is already finished', 400);
    }

    const result = TaskQueueModel.update(id, { status: 'cancelled' });
    if (result && result.error) {
      throw new AppError('VALIDATION_ERROR', result.error, 400);
    }

    this._runningQueues.set(id, false);

    // 标记当前执行中的项目为失败
    const updated = TaskQueueModel.findById(id);
    if (updated) {
      const currentItem = updated.items[updated.currentItemIndex];
      if (currentItem && currentItem.status === 'running') {
        TaskQueueModel.updateItemStatus(updated.id, currentItem.id, 'failed', { error: 'Queue cancelled' });
      }
    }

    this._broadcastQueueUpdate(id, 'cancelled', { name: queue.name });
    return TaskQueueModel.findById(id);
  }

  /**
   * 执行队列（内部方法）
   */
  private static async _executeQueue(queueId: string): Promise<void> {
    const queue = TaskQueueModel.findById(queueId);
    if (!queue) return;

    if (!this._runningQueues.get(queueId) || queue.status !== 'running') {
      logger.info(`Queue ${queueId} paused or stopped at item ${queue.currentItemIndex}`);
      return;
    }

    // 跳过已完成的项目
    while (queue.currentItemIndex < queue.items.length &&
           queue.items[queue.currentItemIndex]?.status === 'completed') {
      queue.currentItemIndex++;
    }

    if (queue.currentItemIndex >= queue.items.length) {
      TaskQueueModel.update(queueId, { status: 'completed' });
      this._runningQueues.set(queueId, false);
      this._broadcastQueueUpdate(queueId, 'completed', { name: queue.name });
      return;
    }

    const item = queue.items[queue.currentItemIndex];
    if (!item) return;

    TaskQueueModel.updateItemStatus(queueId, item.id, 'running');
    this._broadcastQueueUpdate(queueId, 'itemStarted', {
      itemId: item.id,
      index: queue.currentItemIndex,
      input: item.input
    });

    try {
      const TaskService = require('./TaskService');
      TaskService.create({
        title: `队列任务 - ${queue.name} (${queue.currentItemIndex + 1}/${queue.items.length})`,
        description: item.input,
        workflowId: queue.workflowId,
        input: item.input,
        queueId: queueId,
        queueItemId: item.id,
        autoExecute: true
      });
    } catch (error: any) {
      TaskQueueModel.updateItemStatus(queueId, item.id, 'failed', { error: error.message || 'Execution failed' });
      this._broadcastQueueUpdate(queueId, 'itemFailed', {
        itemId: item.id,
        index: queue.currentItemIndex,
        error: error.message
      });

      if (queue.autoStopOnError) {
        TaskQueueModel.update(queueId, { status: 'failed' });
        this._runningQueues.set(queueId, false);
        this._broadcastQueueUpdate(queueId, 'failed', {
          name: queue.name,
          error: `Failed at item ${queue.currentItemIndex}: ${error.message}`
        });
        return;
      }

      queue.currentItemIndex++;
      this._executeQueue(queueId).catch(err => {
        logger.error(`Queue ${queueId} execution error:`, err);
      });
    }
  }

  /**
   * 添加队列项
   */
  static addItem(queueId: string, data: any): any {
    const queue = this.getById(queueId);
    const item = {
      id: Math.random().toString(36).substring(7),
      index: queue.items.length,
      input: data.input,
      status: 'pending',
      createdAt: new Date()
    };
    queue.items.push(item);
    TaskQueueModel.update(queueId, { items: queue.items, updatedAt: new Date() });
    return item;
  }

  /**
   * 删除队列项
   */
  static removeItem(queueId: string, itemId: string): void {
    const queue = this.getById(queueId);
    const idx = queue.items.findIndex((i: any) => i.id === itemId);
    if (idx === -1) {
      throw new AppError('NOT_FOUND', `Item '${itemId}' not found`, 404);
    }
    queue.items.splice(idx, 1);
    TaskQueueModel.update(queueId, { items: queue.items, updatedAt: new Date() });
  }

  /**
   * 任务完成回调（由 TaskService 调用）
   */
  static _onTaskComplete(queueId: string, itemId: string, taskId: string, result: any): void {
    const queue = TaskQueueModel.findById(queueId);
    if (!queue) return;

    TaskQueueModel.updateItemStatus(queueId, itemId, 'completed', { output: result });
    TaskQueueModel.update(queueId, { completedCount: (queue.completedCount || 0) + 1 });
    this._broadcastQueueUpdate(queueId, 'itemCompleted', { itemId, taskId, result });
    this._continueQueue(queueId);
  }

  /**
   * 任务失败回调（由 TaskService 调用）
   */
  static _onTaskFail(queueId: string, itemId: string, taskId: string, error: string): void {
    const queue = TaskQueueModel.findById(queueId);
    if (!queue) return;

    TaskQueueModel.updateItemStatus(queueId, itemId, 'failed', { error });
    TaskQueueModel.update(queueId, { failedCount: (queue.failedCount || 0) + 1 });
    this._broadcastQueueUpdate(queueId, 'itemFailed', { itemId, taskId, error });

    if (queue.autoStopOnError) {
      TaskQueueModel.update(queueId, { status: 'failed' });
      this._runningQueues.set(queueId, false);
      this._broadcastQueueUpdate(queueId, 'failed', {
        name: queue.name,
        error: `Failed at item ${queue.currentItemIndex}: ${error}`
      });
      return;
    }

    this._continueQueue(queueId);
  }

  /**
   * 通知人工干预（暂停队列，将当前 item 标记为 waiting_human）
   */
  static notifyHumanIntervention(queueId: string, runId: string, nodeId: string, type: string): void {
    const queue = TaskQueueModel.findById(queueId);
    if (!queue) return;

    // 将当前 running 的 item 转为 waiting_human
    const item = queue.items[queue.currentItemIndex];
    if (item && item.status === 'running') {
      TaskQueueModel.updateItemStatus(queueId, item.id, 'waiting_human', {
        waitingHumanType: type,
        waitingNodeId: nodeId
      });
    }

    TaskQueueModel.update(queueId, { status: 'paused' });
    this._runningQueues.set(queueId, false);
    this._broadcastQueueUpdate(queueId, 'humanIntervention', { runId, nodeId, type });
  }

  /**
   * 通知人工响应（恢复队列，将 waiting_human 的 item 转回 running）
   */
  static notifyHumanResponse(queueId: string, workflowId: string, nodeId: string): void {
    const queue = TaskQueueModel.findById(queueId);
    if (!queue) return;

    // 将 waiting_human 的 item 恢复为 running
    const item = queue.items.find((i: any) => i.status === 'waiting_human');
    if (item) {
      TaskQueueModel.updateItemStatus(queueId, item.id, 'running', {
        waitingHumanType: null,
        waitingNodeId: null
      });
    }

    TaskQueueModel.update(queueId, { status: 'running' });
    this._runningQueues.set(queueId, true);
    this._broadcastQueueUpdate(queueId, 'humanResponse', { workflowId, nodeId });
  }

  /**
   * 继续执行队列（内部方法）
   */
  private static _continueQueue(queueId: string): void {
    const queue = TaskQueueModel.findById(queueId);
    if (!queue || queue.status !== 'running') return;

    const newIndex = queue.currentItemIndex + 1;
    TaskQueueModel.update(queueId, { currentItemIndex: newIndex });

    if (newIndex >= queue.items.length) {
      TaskQueueModel.update(queueId, { status: 'completed' });
      this._runningQueues.set(queueId, false);
      this._broadcastQueueUpdate(queueId, 'completed', { name: queue.name });
      return;
    }

    this._executeQueue(queueId).catch(err => {
      logger.error(`Queue ${queueId} execution error:`, err);
    });
  }
}

module.exports = TaskQueueService;
