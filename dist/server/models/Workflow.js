"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require('path');
const fs = require('fs');
const { generateId } = require('../utils/id');
const config = require('../config');
const { atomicWriteSync, atomicWriteAsync } = require('../utils/atomicWrite');
const logger = require('../utils/logger');
// In-memory store — all workflows belong to a workspace
const workflows = new Map();
/**
 * Workflow Model - In-memory CRUD operations
 */
class WorkflowModel {
    static _persistPending = false;
    static create(data) {
        const now = new Date();
        const nodes = (data.nodes || []).map((n) => ({
            id: n.id,
            label: n.label || '',
            type: n.type || 'agent',
            agentId: n.agentId || '',
            position: n.position || { x: 0, y: 0 },
            config: n.config || {},
            defaultPrompt: n.defaultPrompt || '',
            requiresInput: n.requiresInput || false,
            status: n.status || 'pending',
            output: n.output || null,
            startedAt: n.startedAt || null,
            completedAt: n.completedAt || null,
            logs: n.logs || []
        }));
        if (nodes.length > 0 && !nodes.some((n) => n.type === 'start')) {
            nodes[0].type = 'start';
        }
        let workspaceId = data.workspaceId || null;
        if (!workspaceId) {
            try {
                const WorkspaceManager = require('../services/WorkspaceManager');
                const active = WorkspaceManager.getActive();
                if (active.length > 0) {
                    workspaceId = active[active.length - 1].id;
                }
            }
            catch (e) { /* ignore */ }
        }
        const workflow = {
            id: generateId(),
            name: data.name,
            description: data.description || '',
            status: 'draft',
            folderPath: data.folderPath || null,
            workspaceId,
            nodes,
            edges: data.edges || [],
            executionLog: [],
            context: data.context || {},
            memoryEnabled: data.memoryEnabled === true,
            memorySource: data.memorySource || null,
            knowledgeSource: data.memorySource || null,
            createdAt: now,
            updatedAt: now,
            executionStatus: 'idle',
            currentRunId: null
        };
        workflows.set(workflow.id, workflow);
        this._persist();
        return { ...workflow };
    }
    static createInAllWorkspaces(data) {
        const FileService = require('../services/FileService');
        const WorkspaceManager = require('../services/WorkspaceManager');
        const activeWorkspaces = WorkspaceManager.getActive();
        const currentPath = FileService.runtimeWorkspaceRoot;
        const currentWs = WorkspaceManager.findByPath(currentPath);
        const created = [];
        for (const ws of activeWorkspaces) {
            const now = new Date();
            const nodes = (data.nodes || []).map((n) => ({
                id: n.id, label: n.label || '', type: n.type || 'agent',
                agentId: n.agentId || '', position: n.position || { x: 0, y: 0 },
                config: n.config || {}, defaultPrompt: n.defaultPrompt || '',
                requiresInput: n.requiresInput || false, status: n.status || 'pending',
                output: n.output || null, startedAt: n.startedAt || null,
                completedAt: n.completedAt || null, logs: n.logs || []
            }));
            if (nodes.length > 0 && !nodes.some((n) => n.type === 'start'))
                nodes[0].type = 'start';
            const workflow = {
                id: generateId(), name: data.name, description: data.description || '',
                status: 'draft', folderPath: ws.path, workspaceId: ws.id,
                nodes, edges: data.edges || [], executionLog: [], context: data.context || {},
                memorySource: data.memorySource || null, knowledgeSource: data.memorySource || null,
                createdAt: now, updatedAt: now, executionStatus: 'idle', currentRunId: null
            };
            if (currentWs && ws.id === currentWs.id) {
                // 当前工作区：添加到内存Map
                workflows.set(workflow.id, workflow);
            }
            else {
                // 其他工作区：直接写入文件
                try {
                    const wfPath = path.join(ws.path, 'WORKFLOWS', 'workflows.json');
                    let existing = [];
                    if (fs.existsSync(wfPath)) {
                        try {
                            existing = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
                        }
                        catch (_) {
                            existing = [];
                        }
                    }
                    existing.push(workflow);
                    atomicWriteSync(wfPath, JSON.stringify(existing, null, 2));
                }
                catch (e) {
                    logger.error(`Failed to write workflow to ${ws.path}: ${e.message}`);
                }
            }
            created.push({ ...workflow });
        }
        // 持久化当前工作区
        if (currentWs && created.length > 0)
            this._persist();
        return created;
    }
    static getAll() {
        return Array.from(workflows.values());
    }
    static findAll({ status, workspaceId, page = 1, limit = 20 } = {}) {
        let results = Array.from(workflows.values());
        if (status)
            results = results.filter((w) => w.status === status);
        if (workspaceId)
            results = results.filter((w) => w.workspaceId === workspaceId);
        const total = results.length;
        const start = (page - 1) * limit;
        const paginated = results.slice(start, start + limit);
        return {
            items: paginated.map((w) => this._normalize({ ...w })),
            total,
            page,
            limit
        };
    }
    static findById(id) {
        const workflow = workflows.get(id);
        if (!workflow)
            return null;
        return this._normalize({ ...workflow, nodes: workflow.nodes.map((n) => ({ ...n })) });
    }
    static _normalize(workflow) {
        if (!workflow)
            return null;
        return {
            ...workflow,
            folderPath: workflow.folderPath || null,
            executionStatus: workflow.executionStatus || 'idle',
            currentRunId: workflow.currentRunId || null,
            context: workflow.context || {},
            nodes: (workflow.nodes || []).map((n) => ({
                ...n,
                defaultPrompt: n.defaultPrompt || '',
                requiresInput: n.requiresInput || false,
                status: n.status || 'pending',
                output: n.output || null,
                startedAt: n.startedAt || null,
                completedAt: n.completedAt || null,
                logs: n.logs || []
            }))
        };
    }
    static getExecutionStatus(id) {
        const workflow = workflows.get(id);
        if (!workflow)
            return null;
        return {
            workflowId: id,
            status: workflow.executionStatus || 'idle',
            runId: workflow.currentRunId || null,
            nodes: (workflow.nodes || []).map((n) => ({
                id: n.id,
                label: n.label || n.id,
                type: n.type,
                status: n.status || 'pending',
                output: n.output || null,
                startedAt: n.startedAt || null,
                completedAt: n.completedAt || null,
                logs: n.logs || []
            }))
        };
    }
    static updateNodeStatus(workflowId, nodeId, status, output) {
        const workflow = workflows.get(workflowId);
        if (!workflow)
            return null;
        const node = workflow.nodes.find((n) => n.id === nodeId);
        if (!node)
            return null;
        node.status = status;
        if (output !== undefined)
            node.output = output;
        if (status === 'running')
            node.startedAt = new Date();
        if (status === 'completed' || status === 'failed' || status === 'skipped')
            node.completedAt = new Date();
        workflow.updatedAt = new Date();
        this._persist();
        return { ...node };
    }
    static update(id, data) {
        const workflow = workflows.get(id);
        if (!workflow)
            return null;
        if (data.name !== undefined)
            workflow.name = data.name;
        if (data.description !== undefined)
            workflow.description = data.description;
        if (data.status !== undefined)
            workflow.status = data.status;
        if (data.folderPath !== undefined)
            workflow.folderPath = data.folderPath;
        if (data.nodes !== undefined)
            workflow.nodes = data.nodes;
        if (data.edges !== undefined)
            workflow.edges = data.edges;
        if (data.executionLog !== undefined)
            workflow.executionLog = data.executionLog;
        if (data.executionStatus !== undefined)
            workflow.executionStatus = data.executionStatus;
        if (data.currentRunId !== undefined)
            workflow.currentRunId = data.currentRunId;
        if (data.context !== undefined)
            workflow.context = data.context;
        if (data.memoryEnabled !== undefined)
            workflow.memoryEnabled = data.memoryEnabled;
        if (data.memorySource !== undefined)
            workflow.memorySource = data.memorySource;
        if (data.knowledgeSource !== undefined)
            workflow.knowledgeSource = data.knowledgeSource;
        workflow.updatedAt = new Date();
        this._persist();
        return { ...workflow };
    }
    static delete(id) {
        const workflow = workflows.get(id);
        if (!workflow)
            return false;
        try {
            const MemoryService = require('../services/MemoryService');
            MemoryService.deleteMemory(id);
            MemoryService.cleanSharedPool(id);
        }
        catch (e) { /* ignore */ }
        try {
            const CheckpointService = require('../services/CheckpointService');
            CheckpointService.deleteAllCheckpoints(id);
        }
        catch (e) { /* ignore */ }
        try {
            const SnapshotService = require('../services/SnapshotService');
            const snapshots = SnapshotService.getSnapshots(id);
            if (Array.isArray(snapshots)) {
                for (const s of snapshots) {
                    try {
                        SnapshotService.delete(id, s.id);
                    }
                    catch (e) { /* ignore */ }
                }
            }
        }
        catch (e) { /* ignore */ }
        workflows.delete(id);
        this._persist();
        return true;
    }
    static exists(id) {
        return workflows.has(id);
    }
    static removeExecutionLog(workflowId, runId) {
        const workflow = workflows.get(workflowId);
        if (!workflow || !workflow.executionLog)
            return false;
        const idx = workflow.executionLog.findIndex((log) => log.runId === runId);
        if (idx === -1)
            return false;
        workflow.executionLog.splice(idx, 1);
        workflow.updatedAt = new Date().toISOString();
        this._persist();
        return true;
    }
    static addExecutionLog(id, entry) {
        const workflow = workflows.get(id);
        if (!workflow)
            return null;
        workflow.executionLog.push(entry);
        workflow.updatedAt = new Date();
        this._persist();
        return entry;
    }
    static _removeFromMap(workspaceId) {
        for (const [id, wf] of workflows.entries()) {
            if (wf.workspaceId === workspaceId) {
                workflows.delete(id);
            }
        }
    }
    static clear() {
        workflows.clear();
    }
    static count() {
        return workflows.size;
    }
    static reload(workflowArray) {
        if (!Array.isArray(workflowArray))
            return;
        workflowArray.forEach((wf) => {
            if (wf && wf.id) {
                workflows.set(wf.id, wf);
            }
        });
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
        const allWorkflows = Array.from(workflows.values());
        try {
            // 优先写到当前激活的 workspace 子目录；若无 workspace 则回退到 DATA_DIR 根目录
            let wfPath = null;
            let wsWorkflows = allWorkflows;
            try {
                const FileService = require('../services/FileService');
                const WorkspaceManager = require('../services/WorkspaceManager');
                const currentPath = FileService.runtimeWorkspaceRoot;
                const currentWs = currentPath ? WorkspaceManager.findByPath(currentPath) : null;
                if (currentWs) {
                    wsWorkflows = allWorkflows.filter((wf) => wf.workspaceId === currentWs.id);
                    wfPath = path.join(currentWs.path, 'WORKFLOWS', 'workflows.json');
                }
            }
            catch (e) {
                // ignore — 回退到 DATA_DIR
            }
            if (!wfPath) {
                wfPath = path.join(config.data.dir, config.data.workflowsFile || 'workflows.json');
            }
            const dir = path.dirname(wfPath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            await atomicWriteAsync(wfPath, JSON.stringify(wsWorkflows, null, 2));
        }
        catch (e) {
            logger.error(`Failed to persist workspace workflows: ${e.message}`);
        }
    }
    static _doPersistSync() {
        this._persistPending = false;
        const allWorkflows = Array.from(workflows.values());
        try {
            // 优先写到当前激活的 workspace 子目录；若无 workspace 则回退到 DATA_DIR 根目录
            let wfPath = null;
            let wsWorkflows = allWorkflows;
            try {
                const FileService = require('../services/FileService');
                const WorkspaceManager = require('../services/WorkspaceManager');
                const currentPath = FileService.runtimeWorkspaceRoot;
                const currentWs = currentPath ? WorkspaceManager.findByPath(currentPath) : null;
                if (currentWs) {
                    wsWorkflows = allWorkflows.filter((wf) => wf.workspaceId === currentWs.id);
                    wfPath = path.join(currentWs.path, 'WORKFLOWS', 'workflows.json');
                }
            }
            catch (e) {
                // ignore — 回退到 DATA_DIR
            }
            if (!wfPath) {
                wfPath = path.join(config.data.dir, config.data.workflowsFile || 'workflows.json');
            }
            const dir = path.dirname(wfPath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            atomicWriteSync(wfPath, JSON.stringify(wsWorkflows, null, 2));
        }
        catch (e) {
            logger.error(`Failed to persist workspace workflows: ${e.message}`);
        }
    }
}
WorkflowModel._persistPending = false;
module.exports = WorkflowModel;
//# sourceMappingURL=Workflow.js.map