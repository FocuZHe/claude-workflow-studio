/**
 * TaskQueueService - 任务队列服务
 * 管理异步任务队列，支持顺序执行、暂停/恢复、错误处理
 */

const logger = require('../utils/logger');

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
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  items: any[];
  currentItemIndex: number;
  autoStopOnError: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class TaskQueueService {
  private static tasks: Map<string, Task> = new Map();
  private static queues: Map<string, TaskQueue> = new Map();
  private static _broadcastService: any = null;
  private static _runningQueues: Map<string, boolean> = new Map(); // 队列执行状态

  /**
   * 初始化广播服务
   */
  static init(broadcastService: any): void {
    TaskQueueService._broadcastService = broadcastService;
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
   * 重置卡住的任务
   */
  static resetStuckQueues(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'running') {
        task.status = 'pending';
        task.updatedAt = new Date();
      }
    }
  }

  /**
   * 创建任务队列
   */
  static create(data: any): TaskQueue {
    const queue: TaskQueue = {
      id: Math.random().toString(36).substring(7),
      name: data.name,
      description: data.description,
      workflowId: data.workflowId,
      status: 'idle',
      items: (data.items || []).map((item: any, idx: number) => ({
        id: Math.random().toString(36).substring(7),
        index: idx,
        input: item.input || item,
        status: 'pending',
        createdAt: new Date()
      })),
      currentItemIndex: 0,
      autoStopOnError: data.autoStopOnError !== false, // 默认遇到错误停止
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.queues.set(queue.id, queue);
    return queue;
  }

  /**
   * 列出任务队列
   */
  static list(params: { status?: string; workflowId?: string; page?: string; limit?: string }): { items: TaskQueue[]; total: number; page: number; limit: number } {
    let items = Array.from(this.queues.values());
    if (params.status) items = items.filter(q => q.status === params.status);
    if (params.workflowId) items = items.filter(q => q.workflowId === params.workflowId);
    const page = parseInt(params.page || '1') || 1;
    const limit = parseInt(params.limit || '20') || 20;
    const total = items.length;
    items = items.slice((page - 1) * limit, page * limit);
    return { items, total, page, limit };
  }

  /**
   * 获取单个任务队列
   */
  static getById(id: string): TaskQueue {
    const queue = this.queues.get(id);
    if (!queue) throw Object.assign(new Error(`Queue '${id}' not found`), { code: 'NOT_FOUND' });
    return queue;
  }

  /**
   * 更新任务队列
   */
  static update(id: string, data: any): TaskQueue {
    const queue = this.getById(id);
    if (data.name !== undefined) queue.name = data.name;
    if (data.description !== undefined) queue.description = data.description;
    queue.updatedAt = new Date();
    return queue;
  }

  /**
   * 删除任务队列
   */
  static delete(id: string): void {
    if (!this.queues.has(id)) throw Object.assign(new Error(`Queue '${id}' not found`), { code: 'NOT_FOUND' });
    this.queues.delete(id);
  }

  /**
   * 开始执行队列
   */
  static async start(id: string): Promise<TaskQueue> {
    const queue = this.getById(id);
    if (queue.status === 'running') {
      throw Object.assign(new Error('Queue is already running'), { code: 'CONFLICT' });
    }

    queue.status = 'running';
    queue.currentItemIndex = 0;
    queue.updatedAt = new Date();
    this._runningQueues.set(id, true);
    this._broadcastQueueUpdate(id, 'started', { name: queue.name });

    // 异步执行队列
    this._executeQueue(id).catch(err => {
      logger.error(`Queue ${id} execution error:`, err);
    });

    return queue;
  }

  /**
   * 暂停队列
   */
  static pause(id: string): TaskQueue {
    const queue = this.getById(id);
    if (queue.status !== 'running') {
      throw Object.assign(new Error('Queue is not running'), { code: 'CONFLICT' });
    }

    queue.status = 'paused';
    queue.updatedAt = new Date();
    this._runningQueues.set(id, false);
    this._broadcastQueueUpdate(id, 'paused', { name: queue.name });
    return queue;
  }

  /**
   * 恢复队列
   */
  static async resume(id: string): Promise<TaskQueue> {
    const queue = this.getById(id);
    if (queue.status !== 'paused') {
      throw Object.assign(new Error('Queue is not paused'), { code: 'CONFLICT' });
    }

    queue.status = 'running';
    queue.updatedAt = new Date();
    this._runningQueues.set(id, true);
    this._broadcastQueueUpdate(id, 'resumed', { name: queue.name });

    // 继续执行队列
    this._executeQueue(id).catch(err => {
      logger.error(`Queue ${id} execution error:`, err);
    });

    return queue;
  }

  /**
   * 取消队列
   */
  static cancel(id: string): TaskQueue {
    const queue = this.getById(id);
    if (queue.status === 'completed' || queue.status === 'cancelled') {
      throw Object.assign(new Error('Queue is already finished'), { code: 'CONFLICT' });
    }

    queue.status = 'cancelled';
    queue.updatedAt = new Date();
    this._runningQueues.set(id, false);

    // 标记当前执行中的项目为失败
    const currentItem = queue.items[queue.currentItemIndex];
    if (currentItem && currentItem.status === 'running') {
      currentItem.status = 'failed';
      currentItem.error = 'Queue cancelled';
      currentItem.updatedAt = new Date();
    }

    this._broadcastQueueUpdate(id, 'cancelled', { name: queue.name });
    return queue;
  }

  /**
   * 执行队列（内部方法）
   * 通过 TaskService 创建任务，任务完成后通过回调继续执行下一个
   */
  private static async _executeQueue(queueId: string): Promise<void> {
    const queue = this.queues.get(queueId);
    if (!queue) return;

    // 检查是否应该继续执行
    if (!this._runningQueues.get(queueId) || queue.status !== 'running') {
      logger.info(`Queue ${queueId} paused or stopped at item ${queue.currentItemIndex}`);
      return;
    }

    // 跳过已完成的项目
    while (queue.currentItemIndex < queue.items.length &&
           queue.items[queue.currentItemIndex]?.status === 'completed') {
      queue.currentItemIndex++;
    }

    // 检查是否还有未完成的项目
    if (queue.currentItemIndex >= queue.items.length) {
      queue.status = 'completed';
      queue.updatedAt = new Date();
      this._runningQueues.set(queueId, false);
      this._broadcastQueueUpdate(queueId, 'completed', { name: queue.name });
      return;
    }

    const item = queue.items[queue.currentItemIndex];
    if (!item) return;

    // 执行当前项目
    item.status = 'running';
    item.startedAt = new Date();
    queue.updatedAt = new Date();
    this._broadcastQueueUpdate(queueId, 'itemStarted', {
      itemId: item.id,
      index: queue.currentItemIndex,
      input: item.input
    });

    try {
      // 调用 TaskService 创建任务（autoExecute 会自动执行）
      const TaskService = require('./TaskService');
      const task = TaskService.create({
        title: `队列任务 - ${queue.name} (${queue.currentItemIndex + 1}/${queue.items.length})`,
        description: item.input,
        workflowId: queue.workflowId,
        input: item.input,
        queueId: queueId,
        queueItemId: item.id,
        autoExecute: true
      });

      // 任务创建后会自动执行，完成后通过回调通知

    } catch (error: any) {
      item.status = 'failed';
      item.error = error.message || 'Execution failed';
      item.updatedAt = new Date();

      this._broadcastQueueUpdate(queueId, 'itemFailed', {
        itemId: item.id,
        index: queue.currentItemIndex,
        error: item.error
      });

      // 如果设置了遇到错误停止，则终止队列
      if (queue.autoStopOnError) {
        queue.status = 'failed';
        queue.updatedAt = new Date();
        this._runningQueues.set(queueId, false);
        this._broadcastQueueUpdate(queueId, 'failed', {
          name: queue.name,
          error: `Failed at item ${queue.currentItemIndex}: ${item.error}`
        });
        return;
      }

      // 继续执行下一个项目
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
    queue.updatedAt = new Date();
    return item;
  }

  /**
   * 删除队列项
   */
  static removeItem(queueId: string, itemId: string): void {
    const queue = this.getById(queueId);
    const idx = queue.items.findIndex((i: any) => i.id === itemId);
    if (idx === -1) throw Object.assign(new Error(`Item '${itemId}' not found`), { code: 'NOT_FOUND' });
    queue.items.splice(idx, 1);
    queue.updatedAt = new Date();
  }

  /**
   * 任务完成回调（由 TaskService 调用）
   */
  static _onTaskComplete(queueId: string, itemId: string, taskId: string, result: any): void {
    const queue = this.queues.get(queueId);
    if (!queue) return;

    const item = queue.items.find((i: any) => i.id === itemId);
    if (!item) return;

    item.status = 'completed';
    item.result = result;
    item.completedAt = new Date();
    item.updatedAt = new Date();

    this._broadcastQueueUpdate(queueId, 'itemCompleted', {
      itemId,
      taskId,
      result
    });

    // 继续执行下一个项目
    this._continueQueue(queueId);
  }

  /**
   * 任务失败回调（由 TaskService 调用）
   */
  static _onTaskFail(queueId: string, itemId: string, taskId: string, error: string): void {
    const queue = this.queues.get(queueId);
    if (!queue) return;

    const item = queue.items.find((i: any) => i.id === itemId);
    if (!item) return;

    item.status = 'failed';
    item.error = error;
    item.updatedAt = new Date();

    this._broadcastQueueUpdate(queueId, 'itemFailed', {
      itemId,
      taskId,
      error
    });

    // 如果设置了遇到错误停止，则终止队列
    if (queue.autoStopOnError) {
      queue.status = 'failed';
      queue.updatedAt = new Date();
      this._runningQueues.set(queueId, false);
      this._broadcastQueueUpdate(queueId, 'failed', {
        name: queue.name,
        error: `Failed at item ${queue.currentItemIndex}: ${error}`
      });
      return;
    }

    // 继续执行下一个项目
    this._continueQueue(queueId);
  }

  /**
   * 继续执行队列（内部方法）
   */
  private static _continueQueue(queueId: string): void {
    const queue = this.queues.get(queueId);
    if (!queue || queue.status !== 'running') return;

    queue.currentItemIndex++;

    // 检查是否还有未完成的项目
    if (queue.currentItemIndex >= queue.items.length) {
      // 所有项目执行完成
      queue.status = 'completed';
      queue.updatedAt = new Date();
      this._runningQueues.set(queueId, false);
      this._broadcastQueueUpdate(queueId, 'completed', { name: queue.name });
      return;
    }

    // 继续执行下一个项目
    this._executeQueue(queueId).catch(err => {
      logger.error(`Queue ${queueId} execution error:`, err);
    });
  }
}

module.exports = TaskQueueService;
