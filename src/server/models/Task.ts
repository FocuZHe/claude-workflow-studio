const path = require('path');
const fs = require('fs');
const { generateId } = require('../utils/id');
const config = require('../config');
const DataStore = require('../utils/DataStore');
const { atomicWriteSync, atomicWriteAsync } = require('../utils/atomicWrite');

// DataStore for persistence
const dataStore = new DataStore(
  path.join(config.data.dir, config.data.tasksFile)
);

// In-memory store, loaded from file on startup
const tasks = new Map();
const savedTasks = dataStore.load();
savedTasks.forEach((task: any) => {
  tasks.set(task.id, task);
});

// Valid status transitions
const STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled', 'paused'],
  paused: ['running', 'cancelled'],
  completed: [],
  failed: ['pending'],
  cancelled: ['pending']
};

/**
 * Task Model - In-memory CRUD operations
 */
class TaskModel {
  static _persistPending: boolean = false;

  static getValidTransitions(status: string): string[] {
    return STATUS_TRANSITIONS[status] || [];
  }

  static isValidTransition(from: string, to: string): boolean {
    const valid = STATUS_TRANSITIONS[from];
    return valid ? valid.includes(to) : false;
  }

  static create(data: any): any {
    const now = new Date();
    const task: any = {
      id: generateId(),
      title: data.title,
      description: data.description || '',
      status: 'pending',
      priority: data.priority || config.task.defaultPriority,
      assignedAgentId: data.assignedAgentId || null,
      workflowId: data.workflowId || null,
      workflowNodeId: data.workflowNodeId || null,
      workflowRunId: null,
      folderPath: data.folderPath || null,
      queueId: data.queueId || null,
      queueItemId: data.queueItemId || null,
      workspaceId: data.workspaceId !== undefined ? data.workspaceId : null,
      workspaceName: data.workspaceName || null,
      workflowName: data.workflowName || null,
      input: data.input || '',
      output: '',
      logs: [],
      timeoutMs: data.timeoutMs || 30 * 60 * 1000,  // 默认30分钟超时
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null
    };
    tasks.set(task.id, task);
    this._persist();
    return { ...task };
  }

  static findAll({ status, priority, assignedAgentId, workflowId, page = 1, limit = 20 }: any = {}): any {
    let results = Array.from(tasks.values());

    if (status) results = results.filter((t: any) => t.status === status);
    if (priority) results = results.filter((t: any) => t.priority === priority);
    if (assignedAgentId) results = results.filter((t: any) => t.assignedAgentId === assignedAgentId);
    if (workflowId) results = results.filter((t: any) => t.workflowId === workflowId);

    // 优先级 + FIFO 排序：先按优先级权重降序，同优先级按创建时间升序
    const PRIORITY_WEIGHT: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
    results.sort((a: any, b: any) => {
      const weightDiff = (PRIORITY_WEIGHT[b.priority] || 2) - (PRIORITY_WEIGHT[a.priority] || 2);
      if (weightDiff !== 0) return weightDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const total = results.length;
    const start = (page - 1) * limit;
    const paginated = results.slice(start, start + limit);

    return {
      items: paginated.map((t: any) => ({ ...t })),
      total,
      page,
      limit
    };
  }

  static findById(id: string): any {
    const task = tasks.get(id);
    return task ? { ...task } : null;
  }

  static update(id: string, data: any): any {
    const task = tasks.get(id);
    if (!task) return null;

    if (data.title !== undefined) task.title = data.title;
    if (data.description !== undefined) task.description = data.description;
    if (data.status !== undefined) {
      if (data.status !== task.status) {
        if (!TaskModel.isValidTransition(task.status, data.status)) {
          return { error: `Invalid status transition from '${task.status}' to '${data.status}'` };
        }
        task.status = data.status;
        if (data.status === 'running') task.startedAt = new Date();
        if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
          task.completedAt = new Date();
        }
      }
    }
    if (data.priority !== undefined) task.priority = data.priority;
    if (data.assignedAgentId !== undefined) task.assignedAgentId = data.assignedAgentId;
    if (data.workflowId !== undefined) task.workflowId = data.workflowId;
    if (data.workflowNodeId !== undefined) task.workflowNodeId = data.workflowNodeId;
    if (data.workflowRunId !== undefined) task.workflowRunId = data.workflowRunId;
    if (data.folderPath !== undefined) task.folderPath = data.folderPath;
    if (data.queueId !== undefined) task.queueId = data.queueId;
    if (data.queueItemId !== undefined) task.queueItemId = data.queueItemId;
    if (data.input !== undefined) task.input = data.input;
    if (data.output !== undefined) task.output = data.output;
    task.updatedAt = new Date();
    this._persist();
    return { ...task };
  }

  static delete(id: string): boolean {
    const task = tasks.get(id);
    if (!task) return false;
    tasks.delete(id);
    this._persist();
    return true;
  }

  static exists(id: string): boolean {
    return tasks.has(id);
  }

  static addLog(id: string, level: string, message: string): any {
    const task = tasks.get(id);
    if (!task) return null;

    const logEntry = {
      timestamp: new Date(),
      level,
      message
    };
    task.logs.push(logEntry);
    task.updatedAt = new Date();
    this._persist();
    return logEntry;
  }

  static _persist(): void {
    if (this._persistPending) return;
    this._persistPending = true;
    setImmediate(() => {
      this._doPersist();
    });
  }

  static _flush(): void {
    if (!this._persistPending) return;
    this._persistPending = false;
    this._doPersistSync();
  }

  static async _doPersist(): Promise<void> {
    this._persistPending = false;
    const data = Array.from(tasks.values());
    try {
      await dataStore.saveAsync(data);
    } catch (e: any) {
      const logger = require('../utils/logger');
      logger.error(`Failed to persist tasks: ${e.message}`);
    }
  }

  static _doPersistSync(): void {
    this._persistPending = false;
    const data = Array.from(tasks.values());
    try {
      dataStore.save(data);
    } catch (e: any) {
      const logger = require('../utils/logger');
      logger.error(`Failed to persist tasks: ${e.message}`);
    }
  }

  static _removeFromMap(workspaceId: string): void {
    for (const [id, t] of tasks.entries()) {
      if (t.workspaceId === workspaceId) {
        tasks.delete(id);
      }
    }
  }

  static clear(): void {
    tasks.clear();
  }

  static reload(taskArray: any[]): void {
    if (!Array.isArray(taskArray)) return;
    taskArray.forEach((task: any) => {
      if (task && task.id) {
        tasks.set(task.id, task);
      }
    });
  }

  static count(): number {
    return tasks.size;
  }
}

TaskModel._persistPending = false;

module.exports = TaskModel;
