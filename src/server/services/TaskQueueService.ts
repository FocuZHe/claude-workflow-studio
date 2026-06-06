/**
 * TaskQueueService - 任务队列服务
 * 管理异步任务队列
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
  status: 'idle' | 'running' | 'paused' | 'completed' | 'cancelled';
  items: any[];
  createdAt: Date;
  updatedAt: Date;
}

export class TaskQueueService {
  private static tasks: Map<string, Task> = new Map();
  private static queues: Map<string, TaskQueue> = new Map();
  private static _broadcastService: any = null;

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
    queue.status = 'running';
    queue.updatedAt = new Date();
    this._broadcastQueueUpdate(id, 'started', { name: queue.name });
    return queue;
  }

  /**
   * 暂停队列
   */
  static pause(id: string): TaskQueue {
    const queue = this.getById(id);
    queue.status = 'paused';
    queue.updatedAt = new Date();
    this._broadcastQueueUpdate(id, 'paused', { name: queue.name });
    return queue;
  }

  /**
   * 恢复队列
   */
  static async resume(id: string): Promise<TaskQueue> {
    const queue = this.getById(id);
    queue.status = 'running';
    queue.updatedAt = new Date();
    this._broadcastQueueUpdate(id, 'resumed', { name: queue.name });
    return queue;
  }

  /**
   * 取消队列
   */
  static cancel(id: string): TaskQueue {
    const queue = this.getById(id);
    queue.status = 'cancelled';
    queue.updatedAt = new Date();
    this._broadcastQueueUpdate(id, 'cancelled', { name: queue.name });
    return queue;
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
}

module.exports = TaskQueueService;
