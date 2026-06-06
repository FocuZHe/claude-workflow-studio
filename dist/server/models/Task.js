"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require('path');
const fs = require('fs');
const { generateId } = require('../utils/id');
const config = require('../config');
const DataStore = require('../utils/DataStore');
const { atomicWriteSync, atomicWriteAsync } = require('../utils/atomicWrite');
// DataStore for persistence
const dataStore = new DataStore(path.join(config.data.dir, config.data.tasksFile));
// In-memory store, loaded from file on startup
const tasks = new Map();
const savedTasks = dataStore.load();
savedTasks.forEach((task) => {
    tasks.set(task.id, task);
});
// Valid status transitions
const STATUS_TRANSITIONS = {
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
    static _persistPending = false;
    static getValidTransitions(status) {
        return STATUS_TRANSITIONS[status] || [];
    }
    static isValidTransition(from, to) {
        const valid = STATUS_TRANSITIONS[from];
        return valid ? valid.includes(to) : false;
    }
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
            timeoutMs: data.timeoutMs || 30 * 60 * 1000, // 默认30分钟超时
            createdAt: now,
            updatedAt: now,
            startedAt: null,
            completedAt: null
        };
        tasks.set(task.id, task);
        this._persist();
        return { ...task };
    }
    static findAll({ status, priority, assignedAgentId, workflowId, page = 1, limit = 20 } = {}) {
        let results = Array.from(tasks.values());
        if (status)
            results = results.filter((t) => t.status === status);
        if (priority)
            results = results.filter((t) => t.priority === priority);
        if (assignedAgentId)
            results = results.filter((t) => t.assignedAgentId === assignedAgentId);
        if (workflowId)
            results = results.filter((t) => t.workflowId === workflowId);
        // 优先级 + FIFO 排序：先按优先级权重降序，同优先级按创建时间升序
        const PRIORITY_WEIGHT = { urgent: 4, high: 3, medium: 2, low: 1 };
        results.sort((a, b) => {
            const weightDiff = (PRIORITY_WEIGHT[b.priority] || 2) - (PRIORITY_WEIGHT[a.priority] || 2);
            if (weightDiff !== 0)
                return weightDiff;
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
        const total = results.length;
        const start = (page - 1) * limit;
        const paginated = results.slice(start, start + limit);
        return {
            items: paginated.map((t) => ({ ...t })),
            total,
            page,
            limit
        };
    }
    static findById(id) {
        const task = tasks.get(id);
        return task ? { ...task } : null;
    }
    static update(id, data) {
        const task = tasks.get(id);
        if (!task)
            return null;
        if (data.title !== undefined)
            task.title = data.title;
        if (data.description !== undefined)
            task.description = data.description;
        if (data.status !== undefined) {
            if (data.status !== task.status) {
                if (!TaskModel.isValidTransition(task.status, data.status)) {
                    return { error: `Invalid status transition from '${task.status}' to '${data.status}'` };
                }
                task.status = data.status;
                if (data.status === 'running')
                    task.startedAt = new Date();
                if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
                    task.completedAt = new Date();
                }
            }
        }
        if (data.priority !== undefined)
            task.priority = data.priority;
        if (data.assignedAgentId !== undefined)
            task.assignedAgentId = data.assignedAgentId;
        if (data.workflowId !== undefined)
            task.workflowId = data.workflowId;
        if (data.workflowNodeId !== undefined)
            task.workflowNodeId = data.workflowNodeId;
        if (data.workflowRunId !== undefined)
            task.workflowRunId = data.workflowRunId;
        if (data.folderPath !== undefined)
            task.folderPath = data.folderPath;
        if (data.queueId !== undefined)
            task.queueId = data.queueId;
        if (data.queueItemId !== undefined)
            task.queueItemId = data.queueItemId;
        if (data.input !== undefined)
            task.input = data.input;
        if (data.output !== undefined)
            task.output = data.output;
        task.updatedAt = new Date();
        this._persist();
        return { ...task };
    }
    static delete(id) {
        const task = tasks.get(id);
        if (!task)
            return false;
        tasks.delete(id);
        this._persist();
        return true;
    }
    static exists(id) {
        return tasks.has(id);
    }
    static addLog(id, level, message) {
        const task = tasks.get(id);
        if (!task)
            return null;
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
    static _persist() {
        if (this._persistPending)
            return;
        this._persistPending = true;
        setImmediate(() => {
            this._doPersist();
        });
    }
    static _flush() {
        if (!this._persistPending)
            return;
        this._persistPending = false;
        this._doPersistSync();
    }
    static async _doPersist() {
        this._persistPending = false;
        const data = Array.from(tasks.values());
        try {
            await dataStore.saveAsync(data);
        }
        catch (e) {
            const logger = require('../utils/logger');
            logger.error(`Failed to persist tasks: ${e.message}`);
        }
    }
    static _doPersistSync() {
        this._persistPending = false;
        const data = Array.from(tasks.values());
        try {
            dataStore.save(data);
        }
        catch (e) {
            const logger = require('../utils/logger');
            logger.error(`Failed to persist tasks: ${e.message}`);
        }
    }
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
    static reload(taskArray) {
        if (!Array.isArray(taskArray))
            return;
        taskArray.forEach((task) => {
            if (task && task.id) {
                tasks.set(task.id, task);
            }
        });
    }
    static count() {
        return tasks.size;
    }
}
TaskModel._persistPending = false;
module.exports = TaskModel;
//# sourceMappingURL=Task.js.map