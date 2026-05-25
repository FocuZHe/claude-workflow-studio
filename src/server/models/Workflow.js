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
 * All workflows are workspace-scoped (no global templates)
 */
class WorkflowModel {
  /**
   * Create a new workflow in the current workspace
   */
  static create(data) {
    const now = new Date();
    const nodes = (data.nodes || []).map(n => ({
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

    // Auto-assign first node as start if no start node exists
    if (nodes.length > 0 && !nodes.some(n => n.type === 'start')) {
      nodes[0].type = 'start';
    }

    // Determine workspaceId
    let workspaceId = data.workspaceId || null;
    if (!workspaceId) {
      try {
        const WorkspaceManager = require('../services/WorkspaceManager');
        const active = WorkspaceManager.getActive();
        if (active.length > 0) {
          workspaceId = active[active.length - 1].id;
        }
      } catch (e) { /* ignore */ }
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

  /**
   * Create a workflow in all active workspaces
   * Returns array of created workflows
   */
  static createInAllWorkspaces(data) {
    const WorkspaceManager = require('../services/WorkspaceManager');
    const FileService = require('../services/FileService');
    const activeWorkspaces = WorkspaceManager.getActive();
    const currentPath = FileService.runtimeWorkspaceRoot;
    const created = [];
    const otherWorkspaces = [];

    for (const ws of activeWorkspaces) {
      const now = new Date();
      const nodes = (data.nodes || []).map(n => ({
        id: n.id, label: n.label || '', type: n.type || 'agent',
        agentId: n.agentId || '', position: n.position || { x: 0, y: 0 },
        config: n.config || {}, defaultPrompt: n.defaultPrompt || '',
        requiresInput: n.requiresInput || false, status: n.status || 'pending',
        output: n.output || null, startedAt: n.startedAt || null,
        completedAt: n.completedAt || null, logs: n.logs || []
      }));
      if (nodes.length > 0 && !nodes.some(n => n.type === 'start')) nodes[0].type = 'start';

      const workflow = {
        id: generateId(), name: data.name, description: data.description || '',
        status: 'draft', folderPath: data.folderPath || null, workspaceId: ws.id,
        nodes, edges: data.edges || [], executionLog: [], context: data.context || {},
        memorySource: data.memorySource || null, knowledgeSource: data.memorySource || null,
        createdAt: now, updatedAt: now, executionStatus: 'idle', currentRunId: null
      };

      if (ws.path === currentPath) {
        // Current workspace: add to Map (shows in frontend immediately)
        workflows.set(workflow.id, workflow);
        created.push({ ...workflow });
      } else {
        // Other workspaces: write directly to their disk file
        otherWorkspaces.push({ ws, workflow });
      }
    }

    // Persist current workspace's workflows via _persist
    if (created.length > 0) this._persist();

    // Write other workspaces' workflows directly to disk
    for (const { ws, workflow } of otherWorkspaces) {
      try {
        const wfPath = path.join(ws.path, 'WORKFLOWS', 'workflows.json');
        let existing = [];
        if (fs.existsSync(wfPath)) {
          try { existing = JSON.parse(fs.readFileSync(wfPath, 'utf-8')); } catch (_) { existing = []; }
        }
        existing.push(workflow);
        atomicWriteSync(wfPath, JSON.stringify(existing, null, 2));
        created.push({ ...workflow });
      } catch (e) {
        logger.error(`Failed to write workflow to ${ws.path}: ${e.message}`);
      }
    }

    return created;
  }

  /**
   * Get all workflows as an array (no pagination)
   */
  static getAll() {
    return Array.from(workflows.values());
  }

  /**
   * Find all workflows with optional filters
   */
  static findAll({ status, workspaceId, page = 1, limit = 20 } = {}) {
    let results = Array.from(workflows.values());

    if (status) {
      results = results.filter(w => w.status === status);
    }
    if (workspaceId) {
      results = results.filter(w => w.workspaceId === workspaceId);
    }

    const total = results.length;
    const start = (page - 1) * limit;
    const paginated = results.slice(start, start + limit);

    return {
      items: paginated.map(w => this._normalize({ ...w })),
      total,
      page,
      limit
    };
  }

  /**
   * Find workflow by ID
   */
  static findById(id) {
    const workflow = workflows.get(id);
    if (!workflow) return null;
    return this._normalize({ ...workflow, nodes: workflow.nodes.map(n => ({ ...n })) });
  }

  /**
   * Normalize workflow data for backward compatibility
   */
  static _normalize(workflow) {
    if (!workflow) return null;
    return {
      ...workflow,
      folderPath: workflow.folderPath || null,
      executionStatus: workflow.executionStatus || 'idle',
      currentRunId: workflow.currentRunId || null,
      context: workflow.context || {},
      nodes: (workflow.nodes || []).map(n => ({
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

  /**
   * Get full execution status for a workflow
   */
  static getExecutionStatus(id) {
    const workflow = workflows.get(id);
    if (!workflow) return null;

    return {
      workflowId: id,
      status: workflow.executionStatus || 'idle',
      runId: workflow.currentRunId || null,
      nodes: (workflow.nodes || []).map(n => ({
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

  /**
   * Update a single node's status within a workflow
   */
  static updateNodeStatus(workflowId, nodeId, status, output) {
    const workflow = workflows.get(workflowId);
    if (!workflow) return null;

    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) return null;

    node.status = status;
    if (output !== undefined) node.output = output;
    if (status === 'running') node.startedAt = new Date();
    if (status === 'completed' || status === 'failed' || status === 'skipped') node.completedAt = new Date();

    workflow.updatedAt = new Date();
    this._persist();
    return { ...node };
  }

  /**
   * Update workflow
   */
  static update(id, data) {
    const workflow = workflows.get(id);
    if (!workflow) return null;

    if (data.name !== undefined) workflow.name = data.name;
    if (data.description !== undefined) workflow.description = data.description;
    if (data.status !== undefined) workflow.status = data.status;
    if (data.folderPath !== undefined) workflow.folderPath = data.folderPath;
    if (data.nodes !== undefined) workflow.nodes = data.nodes;
    if (data.edges !== undefined) workflow.edges = data.edges;
    if (data.executionLog !== undefined) workflow.executionLog = data.executionLog;
    if (data.executionStatus !== undefined) workflow.executionStatus = data.executionStatus;
    if (data.currentRunId !== undefined) workflow.currentRunId = data.currentRunId;
    if (data.context !== undefined) workflow.context = data.context;
    if (data.memorySource !== undefined) workflow.memorySource = data.memorySource;
    if (data.knowledgeSource !== undefined) workflow.knowledgeSource = data.knowledgeSource;
    workflow.updatedAt = new Date();

    this._persist();
    return { ...workflow };
  }

  /**
   * Delete workflow
   */
  static delete(id) {
    const workflow = workflows.get(id);
    if (!workflow) return false;

    // Clean up memory files
    try {
      const MemoryService = require('../services/MemoryService');
      MemoryService.deleteMemory(id);
      MemoryService.cleanSharedPool(id);
    } catch (e) { /* ignore */ }

    // Clean up checkpoints
    try {
      const CheckpointService = require('../services/CheckpointService');
      CheckpointService.deleteAllCheckpoints(id);
    } catch (e) { /* ignore */ }

    // Clean up snapshots
    try {
      const SnapshotService = require('../services/SnapshotService');
      const snapshots = SnapshotService.getSnapshots(id);
      if (Array.isArray(snapshots)) {
        for (const s of snapshots) {
          try { SnapshotService.delete(id, s.id); } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { /* ignore */ }

    workflows.delete(id);
    this._persist();
    return true;
  }

  /**
   * Check if workflow exists
   */
  static exists(id) {
    return workflows.has(id);
  }

  /**
   * Remove a specific execution log entry by runId
   */
  static removeExecutionLog(workflowId, runId) {
    const workflow = workflows.get(workflowId);
    if (!workflow || !workflow.executionLog) return false;
    const idx = workflow.executionLog.findIndex(log => log.runId === runId);
    if (idx === -1) return false;
    workflow.executionLog.splice(idx, 1);
    workflow.updatedAt = new Date().toISOString();
    this._persist();
    return true;
  }

  /**
   * Add execution log entry
   */
  static addExecutionLog(id, entry) {
    const workflow = workflows.get(id);
    if (!workflow) return null;
    workflow.executionLog.push(entry);
    workflow.updatedAt = new Date();
    this._persist();
    return entry;
  }

  /**
   * Remove workflows from Map by workspaceId (for deactivation)
   */
  static _removeFromMap(workspaceId) {
    for (const [id, wf] of workflows.entries()) {
      if (wf.workspaceId === workspaceId) {
        workflows.delete(id);
      }
    }
  }

  /**
   * Clear all workflows (for testing)
   */
  static clear() {
    workflows.clear();
  }

  /**
   * Get count
   */
  static count() {
    return workflows.size;
  }

  /**
   * Reload workflows from an array (e.g. loaded from workspace WORKFLOWS folder)
   */
  static reload(workflowArray) {
    if (!Array.isArray(workflowArray)) return;
    workflowArray.forEach(wf => {
      if (wf && wf.id) {
        workflows.set(wf.id, wf);
      }
    });
  }

  /**
   * Persist current data to workspace file
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
    const allWorkflows = Array.from(workflows.values());

    try {
      const WorkspaceManager = require('../services/WorkspaceManager');
      const activeWorkspaces = WorkspaceManager.getActive();

      // Group workflows by workspaceId
      const grouped = new Map();
      for (const wf of allWorkflows) {
        const wsId = wf.workspaceId || '__unknown__';
        if (!grouped.has(wsId)) grouped.set(wsId, []);
        grouped.get(wsId).push(wf);
      }

      // Save each group to its workspace's WORKFLOWS/workflows.json
      for (const [wsId, wfList] of grouped) {
        if (wsId === '__unknown__') continue;
        const ws = activeWorkspaces.find(w => w.id === wsId);
        if (ws) {
          const wfPath = path.join(ws.path, 'WORKFLOWS', 'workflows.json');
          await atomicWriteAsync(wfPath, JSON.stringify(wfList, null, 2));
        }
      }
    } catch (e) {
      logger.error(`Failed to persist workspace workflows: ${e.message}`);
    }
  }

  static _doPersistSync() {
    this._persistPending = false;
    const allWorkflows = Array.from(workflows.values());

    try {
      const WorkspaceManager = require('../services/WorkspaceManager');
      const activeWorkspaces = WorkspaceManager.getActive();

      // Group workflows by workspaceId
      const grouped = new Map();
      for (const wf of allWorkflows) {
        const wsId = wf.workspaceId || '__unknown__';
        if (!grouped.has(wsId)) grouped.set(wsId, []);
        grouped.get(wsId).push(wf);
      }

      // Save each group to its workspace's WORKFLOWS/workflows.json
      for (const [wsId, wfList] of grouped) {
        if (wsId === '__unknown__') continue;
        const ws = activeWorkspaces.find(w => w.id === wsId);
        if (ws) {
          const wfPath = path.join(ws.path, 'WORKFLOWS', 'workflows.json');
          atomicWriteSync(wfPath, JSON.stringify(wfList, null, 2));
        }
      }
    } catch (e) {
      logger.error(`Failed to persist workspace workflows: ${e.message}`);
    }
  }
}

// Initialize debounce flag
WorkflowModel._persistPending = false;

module.exports = WorkflowModel;
