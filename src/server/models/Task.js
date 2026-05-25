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
savedTasks.forEach(task => {
  tasks.set(task.id, task);
});

// Valid status transitions
const STATUS_TRANSITIONS = {
  pending: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled', 'paused'],
  paused: ['running', 'cancelled'],
  completed: [],
  failed: ['pending'], // Can retry
  cancelled: ['pending'] // Can re-activate
};

/**
 * Task Model - In-memory CRUD operations
 */
class TaskModel {
  /**
   * Get valid transitions for a status
   */
  static getValidTransitions(status) {
    return STATUS_TRANSITIONS[status] || [];
  }

  /**
   * Check if a status transition is valid
   */
  static isValidTransition(from, to) {
    const valid = STATUS_TRANSITIONS[from];
    return valid ? valid.includes(to) : false;
  }

  /**
   * Create a new task
   */
  static create(data) {
    const now = new Date();
    const task = {
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
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null
    };
    tasks.set(task.id, task);
    this._persist();
    return { ...task };
  }

  /**
   * Find all tasks with optional filters
   */
  static findAll({ status, priority, assignedAgentId, workflowId, page = 1, limit = 20 } = {}) {
    let results = Array.from(tasks.values());

    if (status) {
      results = results.filter(t => t.status === status);
    }
    if (priority) {
      results = results.filter(t => t.priority === priority);
    }
    if (assignedAgentId) {
      results = results.filter(t => t.assignedAgentId === assignedAgentId);
    }
    if (workflowId) {
      results = results.filter(t => t.workflowId === workflowId);
    }

    // Sort by creation date descending
    results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = results.length;
    const start = (page - 1) * limit;
    const paginated = results.slice(start, start + limit);

    return {
      items: paginated.map(t => ({ ...t })),
      total,
      page,
      limit
    };
  }

  /**
   * Find task by ID
   */
  static findById(id) {
    const task = tasks.get(id);
    return task ? { ...task } : null;
  }

  /**
   * Update task
   */
  static update(id, data) {
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
        if (data.status === 'running') {
          task.startedAt = new Date();
        }
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

  /**
   * Delete task
   */
  static delete(id) {
    const task = tasks.get(id);
    if (!task) return false;
    tasks.delete(id);
    this._persist();
    return true;
  }

  /**
   * Check if task exists
   */
  static exists(id) {
    return tasks.has(id);
  }

  /**
   * Add log entry to task
   */
  static addLog(id, level, message) {
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

  /**
   * Persist all tasks to the global data/tasks.json.
   */
  static _persist() {
    if (this._persistPending) return;
    this._persistPending = true;
    setImmediate(() => {
      this._doPersist();
    });
  }

  static _flush() {
    if (!this._persistPending) return;
    this._persistPending = false;
    this._doPersistSync();
  }

  static async _doPersist() {
    this._persistPending = false;
    const data = Array.from(tasks.values());
    try {
      await dataStore.saveAsync(data);
    } catch (e) {
      const logger = require('../utils/logger');
      logger.error(`Failed to persist tasks: ${e.message}`);
    }
  }

  static _doPersistSync() {
    this._persistPending = false;
    const data = Array.from(tasks.values());
    try {
      dataStore.save(data);
    } catch (e) {
      const logger = require('../utils/logger');
      logger.error(`Failed to persist tasks: ${e.message}`);
    }
  }

  /**
   * Clear all tasks (for testing)
   */
  /**
   * 从内存 Map 中移除指定工作区的所有条目（不触发磁盘写入）
   */
  static _removeFromMap(workspaceId) {
    for (const [id, t] of tasks.entries()) {
      if (t.workspaceId === workspaceId) {
        tasks.delete(id);
      }
    }
  }

  static clear() {
    tasks.clear();
  }

  /**
   * Reload tasks from an array (e.g. loaded from workspace WORKFLOWS folder).
   * Does NOT trigger persistence.
   * @param {Array} taskArray - Array of task objects
   */
  static reload(taskArray) {
    if (!Array.isArray(taskArray)) return;
    taskArray.forEach(task => {
      if (task && task.id) {
        tasks.set(task.id, task);
      }
    });
  }

  /**
   * Get count
   */
  static count() {
    return tasks.size;
  }
}

// Initialize debounce flag
TaskModel._persistPending = false;

module.exports = TaskModel;
