"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require('path');
const fs = require('fs');
const { generateId } = require('../utils/id');
const config = require('../config');
const DataStore = require('../utils/DataStore');
const { atomicWriteSync, atomicWriteAsync } = require('../utils/atomicWrite');
// DataStore for persistence
const dataStore = new DataStore(path.join(config.data.dir, config.data.taskQueuesFile));
// In-memory store, loaded from file on startup
const taskQueues = new Map();
const savedQueues = dataStore.load();
savedQueues.forEach((queue) => {
    taskQueues.set(queue.id, queue);
});
// Valid queue status transitions
const QUEUE_STATUS_TRANSITIONS = {
    pending: ['running', 'cancelled'],
    running: ['paused', 'completed', 'failed', 'cancelled'],
    paused: ['running', 'cancelled', 'failed'],
    completed: [],
    failed: ['pending'],
    cancelled: ['pending']
};
// Valid item status transitions
const ITEM_STATUS_TRANSITIONS = {
    pending: ['running', 'cancelled'],
    running: ['completed', 'failed', 'cancelled', 'waiting_human'],
    waiting_human: ['running', 'cancelled'],
    completed: [],
    failed: ['pending'],
    cancelled: ['pending']
};
/**
 * TaskQueue Model - In-memory CRUD operations
 */
class TaskQueueModel {
    static _persistPending = false;
    static getValidTransitions(status) {
        return QUEUE_STATUS_TRANSITIONS[status] || [];
    }
    static isValidTransition(from, to) {
        const valid = QUEUE_STATUS_TRANSITIONS[from];
        return valid ? valid.includes(to) : false;
    }
    static isValidItemTransition(from, to) {
        const valid = ITEM_STATUS_TRANSITIONS[from];
        return valid ? valid.includes(to) : false;
    }
    static create(data) {
        const now = new Date();
        const items = (data.items || []).map((item, index) => ({
            id: generateId(),
            input: item.input || '',
            position: item.position !== undefined ? item.position : index,
            status: 'pending',
            taskId: null,
            output: null,
            error: null,
            waitingHumanType: null,
            waitingNodeId: null,
            startedAt: null,
            completedAt: null
        }));
        const queue = {
            id: generateId(),
            name: data.name,
            description: data.description || '',
            workflowId: data.workflowId,
            workspaceId: data.workspaceId !== undefined ? data.workspaceId : null,
            status: 'pending',
            items,
            currentItemIndex: 0,
            autoStopOnError: data.autoStopOnError !== undefined ? data.autoStopOnError : true,
            completedCount: 0,
            failedCount: 0,
            createdAt: now,
            updatedAt: now,
            startedAt: null,
            completedAt: null
        };
        taskQueues.set(queue.id, queue);
        this._persist();
        return { ...queue, items: queue.items.map((i) => ({ ...i })) };
    }
    static findAll({ status, workflowId, page = 1, limit = 20 } = {}) {
        let results = Array.from(taskQueues.values());
        if (status)
            results = results.filter((q) => q.status === status);
        if (workflowId)
            results = results.filter((q) => q.workflowId === workflowId);
        results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const total = results.length;
        const start = (page - 1) * limit;
        const paginated = results.slice(start, start + limit);
        return {
            items: paginated.map((q) => ({ ...q, items: q.items.map((i) => ({ ...i })) })),
            total,
            page,
            limit
        };
    }
    static findById(id) {
        const queue = taskQueues.get(id);
        return queue ? { ...queue, items: queue.items.map((i) => ({ ...i })) } : null;
    }
    static update(id, data) {
        const queue = taskQueues.get(id);
        if (!queue)
            return null;
        if (data.name !== undefined)
            queue.name = data.name;
        if (data.description !== undefined)
            queue.description = data.description;
        if (data.workflowId !== undefined)
            queue.workflowId = data.workflowId;
        if (data.status !== undefined) {
            if (data.status !== queue.status) {
                if (!TaskQueueModel.isValidTransition(queue.status, data.status)) {
                    return { error: `Invalid status transition from '${queue.status}' to '${data.status}'` };
                }
                queue.status = data.status;
                if (data.status === 'running')
                    queue.startedAt = new Date();
                if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
                    queue.completedAt = new Date();
                }
            }
        }
        if (data.currentItemIndex !== undefined)
            queue.currentItemIndex = data.currentItemIndex;
        if (data.autoStopOnError !== undefined)
            queue.autoStopOnError = data.autoStopOnError;
        if (data.completedCount !== undefined)
            queue.completedCount = data.completedCount;
        if (data.failedCount !== undefined)
            queue.failedCount = data.failedCount;
        if (data.items !== undefined)
            queue.items = data.items;
        queue.updatedAt = new Date();
        this._persist();
        return { ...queue, items: queue.items.map((i) => ({ ...i })) };
    }
    static delete(id) {
        const queue = taskQueues.get(id);
        if (!queue)
            return false;
        taskQueues.delete(id);
        this._persist();
        return true;
    }
    static updateItemStatus(queueId, itemId, status, extra = {}) {
        const queue = taskQueues.get(queueId);
        if (!queue)
            return null;
        const item = queue.items.find((i) => i.id === itemId);
        if (!item)
            return null;
        if (status && status !== item.status) {
            if (!TaskQueueModel.isValidItemTransition(item.status, status)) {
                return { error: `Invalid item status transition from '${item.status}' to '${status}'` };
            }
            item.status = status;
            if (status === 'running')
                item.startedAt = new Date();
            if (status === 'completed' || status === 'failed' || status === 'cancelled') {
                item.completedAt = new Date();
            }
        }
        if (extra.taskId !== undefined)
            item.taskId = extra.taskId;
        if (extra.output !== undefined)
            item.output = extra.output;
        if (extra.error !== undefined)
            item.error = extra.error;
        if (extra.waitingHumanType !== undefined)
            item.waitingHumanType = extra.waitingHumanType;
        if (extra.waitingNodeId !== undefined)
            item.waitingNodeId = extra.waitingNodeId;
        queue.updatedAt = new Date();
        this._persist();
        return { ...item };
    }
    static getCurrentItem(queueId) {
        const queue = taskQueues.get(queueId);
        if (!queue)
            return null;
        const idx = queue.currentItemIndex;
        if (idx < 0 || idx >= queue.items.length)
            return null;
        return { ...queue.items[idx] };
    }
    static getNextPendingItem(queueId) {
        const queue = taskQueues.get(queueId);
        if (!queue)
            return null;
        for (let i = queue.currentItemIndex; i < queue.items.length; i++) {
            if (queue.items[i].status === 'pending') {
                return { ...queue.items[i], _index: i };
            }
        }
        return null;
    }
    static exists(id) {
        return taskQueues.has(id);
    }
    static count() {
        return taskQueues.size;
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
        const data = Array.from(taskQueues.values());
        try {
            await dataStore.saveAsync(data);
        }
        catch (e) {
            const logger = require('../utils/logger');
            logger.error(`Failed to persist task queues: ${e.message}`);
        }
    }
    static _doPersistSync() {
        this._persistPending = false;
        const data = Array.from(taskQueues.values());
        try {
            dataStore.save(data);
        }
        catch (e) {
            const logger = require('../utils/logger');
            logger.error(`Failed to persist task queues: ${e.message}`);
        }
    }
    static clear() {
        taskQueues.clear();
    }
    static reload(queueArray) {
        if (!Array.isArray(queueArray))
            return;
        for (const queue of queueArray) {
            if (queue && queue.id) {
                taskQueues.set(queue.id, queue);
            }
        }
    }
}
TaskQueueModel._persistPending = false;
module.exports = TaskQueueModel;
//# sourceMappingURL=TaskQueue.js.map