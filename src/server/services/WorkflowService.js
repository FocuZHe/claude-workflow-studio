const path = require('path');
const WorkflowModel = require('../models/Workflow');
const AgentModel = require('../models/Agent');
const TaskModel = require('../models/Task');
const FileService = require('./FileService');
const WorkspaceStateService = require('./WorkspaceStateService');
const { AppError } = require('../middleware/errorHandler');
const { generateId } = require('../utils/id');
const SelfRepair = require('../utils/SelfRepair');
const logger = require('../utils/logger');

/**
 * Workflow business logic service
 */
class WorkflowService {
  /** @type {import('./BroadcastService')|null} */
  static _broadcastService = null;

  /** @type {import('./ClaudeService')|null} */
  static _claudeService = null;

  /** @type {Map<string, {resolve: Function, reject: Function, timer: NodeJS.Timeout, workflowId: string, nodeId: string}>} */
  static _pendingApprovals = new Map();

  /**
   * Initialize WorkflowService with dependencies
   * @param {import('./BroadcastService')} broadcastService
   * @param {import('./ClaudeService')} [claudeService]
   */
  static init(broadcastService, claudeService) {
    WorkflowService._broadcastService = broadcastService;
    if (claudeService) {
      WorkflowService._claudeService = claudeService;
    }
  }

  /**
   * Reset nodes that were waiting for human intervention when server restarted.
   * Pending promises are in-memory only, so they are lost on restart.
   */
  static resetStuckNodes() {
    try {
      const result = WorkflowModel.findAll({ limit: 99999 });
      const workflows = Array.isArray(result) ? result : (result.items || []);
      let resetCount = 0;
      for (const wf of workflows) {
        let hasStuckNodes = false;
        for (const node of (wf.nodes || [])) {
          if (node.status === 'running') {
            // Check if there is a checkpoint for this workflow
            try {
              const CheckpointService = require('./CheckpointService');
              const checkpoint = CheckpointService.getLatestCheckpoint(wf.id);
              if (checkpoint) {
                // Has checkpoint: mark workflow as interrupted (resumable)
                WorkflowModel.update(wf.id, { executionStatus: 'interrupted', currentRunId: checkpoint.runId });
                logger.info(`Workflow ${wf.id} marked as interrupted (has checkpoint)`);
                hasStuckNodes = true;
                break; // Don't reset individual nodes if we have a checkpoint
              }
            } catch (e) { /* checkpoint check is best-effort */ }
            // No checkpoint: reset stale 'running' nodes from previous session
            WorkflowModel.updateNodeStatus(wf.id, node.id, 'pending');
            hasStuckNodes = true;
            resetCount++;
            logger.info(`Reset stale running node ${node.id} in workflow ${wf.id}`);
          }
        }
        // Reset workflow status if it was left as 'running' from a previous session
        if (wf.status === 'running' || wf.executionStatus === 'running') {
          // Check if checkpoint case above already handled this (set interrupted)
          const fresh = WorkflowModel.findById(wf.id);
          if (fresh && fresh.executionStatus === 'interrupted') {
            // Checkpoint case handled executionStatus, just fix status for delete-ability
            WorkflowModel.update(wf.id, { status: 'paused' });
          } else {
            WorkflowModel.update(wf.id, { executionStatus: 'idle', status: 'draft', currentRunId: null });
          }
          logger.info(`Reset stale execution status for workflow ${wf.id}`);
        }
      }
      if (resetCount > 0) {
        logger.info(`Reset ${resetCount} stuck/stale nodes on server startup`);
      }
    } catch (err) {
      logger.warn(`Failed to reset stuck nodes: ${err.message}`);
    }
  }

  /**
   * Create a new workflow
   */
  static create(data) {
    // Validate graph before creating
    if (data.nodes && data.nodes.length > 1) {
      const validation = WorkflowService.validateGraph(data.nodes, data.edges || []);
      if (!validation.valid) {
        throw new AppError('VALIDATION_ERROR', '无效的工作流图', 400, validation.errors);
      }
    }
    const workflow = WorkflowModel.create(data);
    logger.info(`Workflow created: ${workflow.id}`, { name: workflow.name });
    return workflow;
  }

  /**
   * List workflows
   */
  static list(filters) {
    return WorkflowModel.findAll(filters);
  }

  /**
   * Get workflow by ID
   */
  static getById(id) {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }
    return workflow;
  }

  /**
   * Update workflow with graph validation
   */
  static update(id, data) {
    const existing = WorkflowModel.findById(id);
    if (!existing) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }

    // Validate graph if nodes or edges are being updated
    if (data.nodes || data.edges) {
      const nodes = data.nodes || existing.nodes;
      const edges = data.edges || existing.edges;
      const validation = WorkflowService.validateGraph(nodes, edges);
      if (!validation.valid) {
        throw new AppError('VALIDATION_ERROR', '无效的工作流图', 400, validation.errors);
      }

      // Validate agent references
      const agentValidation = WorkflowService.validateAgentReferences(nodes);
      if (!agentValidation.valid) {
        throw new AppError('VALIDATION_ERROR', '无效的智能体引用', 400, agentValidation.errors);
      }
    }

    const workflow = WorkflowModel.update(id, data);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }
    logger.info(`Workflow updated: ${id}`);
    return workflow;
  }

  /**
   * Delete workflow
   */
  static delete(id) {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }
    if (workflow.status === 'running' && workflow.executionStatus === 'running') {
      throw new AppError('CONFLICT', '工作流正在运行中，无法删除。请先停止工作流。', 409);
    }

    // Clean up associated resources (best-effort)
    this._cleanupWorkflowResources(id);

    WorkflowModel.delete(id);
    logger.info(`Workflow deleted: ${id}`);
    return true;
  }

  /**
   * Clean up all resources associated with a workflow (memory, checkpoints, snapshots)
   */
  static _cleanupWorkflowResources(workflowId) {
    try {
      const MemoryService = require('./MemoryService');
      MemoryService.deleteMemory(workflowId);
      MemoryService.cleanSharedPool(workflowId);
    } catch (e) { logger.warn(`Failed to delete memory for workflow ${workflowId}: ${e.message}`); }

    try {
      const CheckpointService = require('./CheckpointService');
      CheckpointService.deleteAllCheckpoints(workflowId);
    } catch (e) { logger.warn(`Failed to delete checkpoints for workflow ${workflowId}: ${e.message}`); }

    try {
      const SnapshotService = require('./SnapshotService');
      const snapshots = SnapshotService.getSnapshots(workflowId);
      if (Array.isArray(snapshots)) {
        for (const s of snapshots) {
          try { SnapshotService.delete(workflowId, s.id); } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { logger.warn(`Failed to delete snapshots for workflow ${workflowId}: ${e.message}`); }
  }

  /**
   * Validate workflow graph integrity
   */
  static validateGraph(nodes, edges) {
    const errors = [];

    if (!nodes || nodes.length === 0) {
      return { valid: true, errors: [] };
    }

    // Build node ID set
    const nodeIds = new Set(nodes.map(n => n.id));

    // Check for start and end nodes
    const hasStart = nodes.some(n => n.type === 'start');
    const hasEnd = nodes.some(n => n.type === 'end');

    // Validate edges reference existing nodes
    for (const edge of edges) {
      const src = edge.source || edge.from;
      const tgt = edge.target || edge.to;
      if (!nodeIds.has(src)) {
        errors.push({ field: `edge.${edge.id}.source`, message: `Source node '${src}' does not exist` });
      }
      if (!nodeIds.has(tgt)) {
        errors.push({ field: `edge.${edge.id}.target`, message: `Target node '${tgt}' does not exist` });
      }
    }

    // Check for orphan nodes (nodes with no edges)
    if (nodes.length > 1) {
      // No edges at all but multiple nodes exist — all are disconnected
      if (edges.length === 0) {
        errors.push({ field: 'edges', message: '工作流需要至少一条连线来连接节点' });
      } else {
        const connectedNodes = new Set();
        for (const edge of edges) {
          connectedNodes.add(edge.source || edge.from);
          connectedNodes.add(edge.target || edge.to);
        }
        for (const node of nodes) {
          if (!connectedNodes.has(node.id)) {
            errors.push({ field: `node.${node.id}`, message: `Node '${node.label || node.id}' is disconnected` });
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      hasStart,
      hasEnd
    };
  }

  /**
   * Validate agent references in workflow nodes
   */
  static validateAgentReferences(nodes) {
    const errors = [];
    for (const node of nodes) {
      if (node.agentId && !AgentModel.exists(node.agentId)) {
        errors.push({
          field: `node.${node.id}.agentId`,
          message: `Agent '${node.agentId}' does not exist`
        });
      }
    }
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Execute workflow - always uses Master Agent mode (native Agent tool collaboration).
   * Returns immediately with runId, execution continues in background.
   * @param {string} id - Workflow ID
   * @param {*} input - Workflow input
   * @param {Object} [params] - Optional parameters injected into execution context
   * @param {Object} [nodeInputs] - Per-node input overrides: { nodeId: userInput, ... }
   */
  static execute(id, input, params, nodeInputs) {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }

    // Validate graph has start node
    const hasStart = workflow.nodes.some(n => n.type === 'start');
    if (!hasStart) {
      throw new AppError('VALIDATION_ERROR', '工作流必须有开始节点', 400);
    }

    // 确保 workflow 有 folderPath（优先使用工作区管理器中的路径）
    if (!workflow.folderPath) {
      try {
        const WorkspaceManager = require('./WorkspaceManager');
        const wsData = workflow.workspaceId ? WorkspaceManager.getById(workflow.workspaceId) : null;
        const workspaceRoot = wsData ? wsData.path : FileService.getWorkspaceRoot();
        if (workspaceRoot) {
          WorkflowModel.update(id, { folderPath: workspaceRoot });
          logger.info(`Workflow ${id} folderPath set to workspace root: ${workspaceRoot}`);
        }
      } catch (e) {
        // 回退到原有逻辑
        const workspaceRoot = FileService.getWorkspaceRoot();
        if (workspaceRoot) {
          WorkflowModel.update(id, { folderPath: workspaceRoot });
          logger.info(`Workflow ${id} folderPath set to workspace root: ${workspaceRoot}`);
        }
      }
    }

    const runId = generateId();
    const executionEntry = {
      runId,
      startedAt: new Date(),
      completedAt: null,
      status: 'running',
      nodeResults: workflow.nodes.map(n => ({
        nodeId: n.id,
        status: 'pending',
        output: null,
        startedAt: null,
        completedAt: null
      }))
    };

    WorkflowModel.addExecutionLog(id, executionEntry);

    // Merge params into workflow context and store nodeInputs
    // Initialize _visitedWorkflows set for circular subworkflow detection
    const existingVisited = workflow.context?._visitedWorkflows || [];
    const visitedSet = new Set(existingVisited);
    visitedSet.add(id);
    const context = { ...(workflow.context || {}), ...(params || {}), __nodeInputs: nodeInputs || {}, _visitedWorkflows: [...visitedSet] };
    WorkflowModel.update(id, {
      status: 'running',
      executionStatus: 'running',
      currentRunId: runId,
      context
    });

    // Reset all node statuses to 'pending' for fresh execution
    for (const node of workflow.nodes) {
      WorkflowModel.updateNodeStatus(id, node.id, 'pending');
    }

    // Memory is now append-only with task tags, no archiving needed

    logger.info(`Workflow execution started: ${id}`, { runId });

    // Broadcast workflow status update
    WorkflowService._broadcastStatusUpdate(id, 'running', runId);

    // Always use Master Agent mode
    logger.info(`Workflow ${id}: using MasterAgent mode (native Agent tool collaboration)`);
    WorkflowService._executeMasterAgent(id, runId, input, workflow).catch(err => {
      logger.error(`MasterAgent execution error: ${id}`, { runId, error: err.message });
      try {
        WorkflowService._failWorkflow(id, runId, err.message);
      } catch (failErr) {
        // Last resort: directly update workflow status to prevent stuck "running" state
        logger.error(`Failed to mark workflow as failed: ${id}`, { error: failErr.message });
        try {
          const WorkflowModel = require('../models/Workflow');
          WorkflowModel.update(id, { status: 'failed', executionStatus: 'failed', error: err.message });
        } catch (_) {
          logger.error(`CRITICAL: Cannot update workflow status for ${id}.workflow may be stuck.`);
        }
      }
    });

    return { runId, status: 'running' };
  }

  /**
   * 主 Agent 模式：用一个 claude 进程 + Agent 工具实现多 Agent 协作
   */
  static async _executeMasterAgent(workflowId, runId, input, workflow) {
    const agentNodes = workflow.nodes.filter(n => n.type === 'agent');
    const conditionNodes = workflow.nodes.filter(n => n.type === 'condition');
    const executableNodes = workflow.nodes.filter(n => n.type !== 'start' && n.type !== 'end');
    const workspaceRoot = workflow.folderPath || FileService.getWorkspaceRoot() || process.cwd();
    if (agentNodes.length === 0 && conditionNodes.length === 0) {
      // No executable nodes — mark all non-meta nodes as completed and finish
      for (const node of workflow.nodes) {
        if (node.type !== 'start' && node.type !== 'end') {
          WorkflowModel.updateNodeStatus(workflowId, node.id, 'completed');
        }
      }
      WorkflowModel.update(workflowId, { executionStatus: 'completed' });
      WorkflowService._broadcastStatusUpdate(workflowId, 'completed', runId);
      logger.info(`Workflow ${workflowId}: no executable agent nodes, marked as completed`);
      return;
    }

    // 更新状态：start→completed，agent/condition→running
    const startNode = workflow.nodes.find(n => n.type === 'start');
    if (startNode) {
      WorkflowModel.updateNodeStatus(workflowId, startNode.id, 'completed');
      WorkflowService._broadcastNodeUpdate(workflowId, runId, startNode.id);
    }
    for (const node of agentNodes) {
      WorkflowModel.updateNodeStatus(workflowId, node.id, 'running');
    }
    for (const node of conditionNodes) {
      WorkflowModel.updateNodeStatus(workflowId, node.id, 'running');
    }
    WorkflowModel.update(workflowId, { executionStatus: 'running' });
    WorkflowService._broadcastStatusUpdate(workflowId, 'running', runId);

    try {
      const MasterAgentService = require('./MasterAgentService');
      const claudeService = WorkflowService._claudeService || global.__claudeService;
      const sdkService = global.__sdkService;
      const execService = sdkService || claudeService;
      if (!execService) throw new Error('No execution service initialized');

      // Load checkpoint data if resuming
      let checkpointData = null;
      if (workflow.context?.__resumeFromCheckpoint) {
        checkpointData = WorkflowService._loadCheckpoint(workflowId, workspaceRoot);
      }

      const systemPrompt = MasterAgentService.buildSystemPrompt(workflow, input, workspaceRoot, checkpointData);
      const taskRunId = `${runId}_master`;

      // Ordered list of executable nodes (non-start, non-end) for checkpoint mapping
      const executableNodes = workflow.nodes.filter(n => n.type !== 'start' && n.type !== 'end');

      // Build node registry: nodeId -> { label, model, systemPrompt, task, skills, mcp }
      const nodeRegistry = {};
      for (const node of executableNodes) {
        if (node.type !== 'agent') continue;
        const agent = node.agentId ? AgentModel.findById(node.agentId) : null;
        const SkillService = require('./SkillService');
        const McpService = require('./McpService');
        // Use Agent's skillNames (from global pool) or node's inline skillNames
        const skillNames = agent?.skillNames || node.skillNames || [];
        const skills = SkillService.getByNames(skillNames).map(s => `${s.name}: ${s.description}`);
        nodeRegistry[node.id] = {
          label: node.label || node.id,
          model: agent?.config?.model || node.config?.model || 'sonnet',
          toolPermissions: agent?.toolPermissions || { executeCommand: true, browser: true, search: true },
          systemPrompt: agent?.config?.systemPrompt || node.config?.systemPrompt || '',
          rolePrompt: agent?.config?.systemPrompt || node.config?.systemPrompt || '',
          task: node.defaultPrompt || '',
          skills,
          mcp: agent?.mcpBindings?.length > 0
            ? McpService.getByAgent(node.agentId).map(m => `${m.name}: ${m.description}`)
            : []
        };
      }

      const output = await execService.execute(taskRunId, null, input, {
        systemPrompt,
        model: 'opus',
        folderPath: workspaceRoot,
        workflowId,
        nodeId: 'master',
        runId,
        executableNodes,
        nodeRegistry,
        onNodeComplete: (nodeId, label, output) => {
          WorkflowModel.updateNodeStatus(workflowId, nodeId, 'completed', output);
          WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);
          // Save per-node checkpoint
          WorkflowService._saveNodeCheckpoint(workspaceRoot, nodeId, { label, output });
        }
      });

      // Handle paused output
      if (typeof output === 'string' && output.startsWith('[PAUSED]')) {
        WorkflowService._saveCheckpoint(workflowId, workspaceRoot, workflow.nodes, output);
        for (const node of executableNodes) {
          if (node.status === 'running') WorkflowModel.updateNodeStatus(workflowId, node.id, 'paused');
        }
        logger.info(`Workflow ${workflowId} paused gracefully`, { runId });
        return;
      }

      // Mark all executable nodes as completed and save checkpoints
      WorkflowService._saveCheckpoint(workflowId, workspaceRoot, workflow.nodes, output);
      for (const node of executableNodes) {
        WorkflowModel.updateNodeStatus(workflowId, node.id, 'completed');
      }
      const endNode = workflow.nodes.find(n => n.type === 'end');
      if (endNode) {
        WorkflowModel.updateNodeStatus(workflowId, endNode.id, 'completed');
        WorkflowService._broadcastNodeUpdate(workflowId, runId, endNode.id);
      }
      WorkflowModel.update(workflowId, { executionStatus: 'completed' });

      // Extract summary from output (last 500 chars, or [文件清单] section)
      const fileListMatch = output.match(/\[文件清单\][\s\S]*?(?=\[|$)/);
      const summary = fileListMatch ? fileListMatch[0].trim().substring(0, 500) : output.slice(-500).trim();

      // Save memory with task tag and agent memory extraction
      try {
        const MemoryService = require('./MemoryService');

        // Extract summary from output
        const memSummary = MemoryService.extractSummary(output);

        // Extract agent markers [记忆: xxx]
        const agentMemories = MemoryService.extractAgentMemory(output);

        // Combine summary with agent memories
        let memoryEntry = memSummary;
        if (agentMemories.length > 0) {
          memoryEntry += '\n\nAgent 主动记忆:\n' + agentMemories.map(m => `- ${m}`).join('\n');
        }

        // Use task input as tag (first 50 chars)
        const tag = (input || '').substring(0, 50).replace(/\n/g, ' ').trim();

        MemoryService.appendMemoryWithTag(workflowId, memoryEntry, tag);
      } catch (e) {
        logger.warn(`Failed to save memory: ${e.message}`);
      }

      WorkflowService._broadcastStatusUpdate(workflowId, 'completed', runId, summary);
      logger.info(`MasterAgent workflow completed: ${workflowId}`, { runId });
    } catch (err) {
      WorkflowService._failWorkflow(workflowId, runId, err.message);
    }
  }

  static _failWorkflow(workflowId, runId, errorMessage) {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) return;
    for (const node of workflow.nodes) {
      if (node.status === 'running' || node.status === 'pending') {
        WorkflowModel.updateNodeStatus(workflowId, node.id, 'failed');
      }
    }
    WorkflowModel.update(workflowId, { executionStatus: 'failed' });
    WorkflowService._broadcastStatusUpdate(workflowId, 'failed', runId);
    logger.error(`Workflow failed: ${workflowId}`, { runId, error: errorMessage });
  }

  /**
   * Get list of agent nodes that require user input before execution
   * @param {string} id - Workflow ID
   * @returns {Array} List of nodes with defaultPrompt and requiresInput info
   */
  static getRequiredInputs(id) {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }

    return workflow.nodes
      .filter(n => n.type === 'agent' && n.requiresInput)
      .map(n => ({
        nodeId: n.id,
        label: n.label || n.id,
        defaultPrompt: n.defaultPrompt || '',
        agentId: n.agentId || null
      }));
  }

  /**
   * Create a Promise that waits for human approval on a specific node.
   * @param {string} workflowId
   * @param {string} nodeId
   * @param {string} requestId - Unique ID to correlate approval decision
   * @param {number} [timeoutMs=600000] - Max wait time (default 10 min)
   * @returns {Promise<{decision: string, comment: string}>}
   */
  /**
   * Save checkpoint files for completed workflow steps
   */
  static _saveCheckpoint(workflowId, workspaceRoot, nodes, masterOutput) {
    try {
      const checkpointDir = path.join(workspaceRoot, '.checkpoint');
      if (!fs.existsSync(checkpointDir)) fs.mkdirSync(checkpointDir, { recursive: true });

      const fs = require('fs');
      const path = require('path');

      const completedAt = new Date().toISOString();

      // Parse master output to extract per-node results
      for (const node of nodes) {
        if (node.type === 'start' || node.type === 'end') continue;
        // Save each node's completion status with enhanced metadata
        const nodeFile = path.join(checkpointDir, `${node.id}.status.json`);
        const startedAt = node.startedAt || completedAt;
        const durationMs = node.startedAt ? (new Date(completedAt) - new Date(node.startedAt)) : null;
        fs.writeFileSync(nodeFile, JSON.stringify({
          nodeId: node.id,
          label: node.label || node.id,
          type: node.type,
          status: node.status || 'completed',
          output: node.output || '',
          startedAt,
          completedAt,
          duration: durationMs,
          model: node.config?.model || null,
          error: node.error || null,
          updatedAt: completedAt
        }, null, 2), 'utf-8');
      }

      // Save master output
      const manifestFile = path.join(checkpointDir, 'manifest.json');
      fs.writeFileSync(manifestFile, JSON.stringify({
        workflowId,
        completedAt,
        nodesCompleted: nodes.filter(n => n.type !== 'start' && n.type !== 'end').length,
        outputLength: masterOutput.length
      }, null, 2), 'utf-8');

      logger.info(`Checkpoint saved for workflow ${workflowId} in ${checkpointDir}`);
    } catch (e) {
      logger.warn(`Failed to save checkpoint: ${e.message}`);
    }
  }

  /**
   * Save a single node's checkpoint file
   */
  static _saveNodeCheckpoint(workspaceRoot, nodeId, { label, output, model, startedAt, error }) {
    try {
      const fs = require('fs');
      const path = require('path');
      const checkpointDir = path.join(workspaceRoot, '.checkpoint');
      if (!fs.existsSync(checkpointDir)) fs.mkdirSync(checkpointDir, { recursive: true });
      const nodeFile = path.join(checkpointDir, `${nodeId}.status.json`);
      const completedAt = new Date().toISOString();
      const started = startedAt ? new Date(startedAt) : null;
      const durationMs = started ? (new Date(completedAt) - started) : null;
      fs.writeFileSync(nodeFile, JSON.stringify({
        nodeId,
        label: label || nodeId,
        status: error ? 'failed' : 'completed',
        output: (output || '').substring(0, 10000),
        startedAt: startedAt || completedAt,
        completedAt,
        duration: durationMs,
        model: model || null,
        error: error || null,
        updatedAt: completedAt
      }, null, 2), 'utf-8');
    } catch (e) {
      logger.warn(`Failed to save node checkpoint: ${e.message}`);
    }
  }

  /**
   * Load checkpoint data for workflow resumption
   */
  static _loadCheckpoint(workflowId, workspaceRoot) {
    try {
      const fs = require('fs');
      const path = require('path');
      const checkpointDir = path.join(workspaceRoot, '.checkpoint');
      if (!fs.existsSync(checkpointDir)) return null;

      const completedNodes = {};
      const files = fs.readdirSync(checkpointDir);
      for (const file of files) {
        if (file.endsWith('.status.json')) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(checkpointDir, file), 'utf-8'));
            if (data.status === 'completed' || data.status === 'skipped') {
              completedNodes[data.nodeId] = { status: data.status, output: data.output || '' };
            }
          } catch (_) {}
        }
      }

      if (Object.keys(completedNodes).length === 0) return null;

      logger.info(`Checkpoint loaded for workflow ${workflowId}: ${Object.keys(completedNodes).length} nodes completed`);
      return { completedNodes };
    } catch (e) {
      logger.warn(`Failed to load checkpoint: ${e.message}`);
      return null;
    }
  }

  static _waitForApproval(workflowId, nodeId, requestId, timeoutMs = 600000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        WorkflowService._pendingApprovals.delete(requestId);
        reject(new Error('审批超时'));
      }, timeoutMs);

      WorkflowService._pendingApprovals.set(requestId, { resolve, reject, timer, workflowId, nodeId });
    });
  }

  /**
   * Resolve a pending approval Promise.
   * @param {string} requestId
   * @param {string} decision - 'approve' or 'reject'
   * @param {string} [comment] - Optional comment
   * @returns {boolean} Whether an approval request was found and resolved
   */
  static handleApprovalDecision(requestId, decision, comment) {
    const pending = WorkflowService._pendingApprovals.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    WorkflowService._pendingApprovals.delete(requestId);

    if (decision === 'approve') {
      pending.resolve({ decision, comment });
    } else {
      pending.reject(new Error(`审批被拒绝${comment ? ': ' + comment : ''}`));
    }
    return true;
  }

  /**
   * Single-step execution: execute only one specific node using Master Agent approach.
   * @param {string} workflowId
   * @param {string} nodeId
   * @returns {Promise<Object>} { nodeId, input, output }
   */
  static async step(workflowId, nodeId) {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
    }

    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) {
      throw new AppError('NOT_FOUND', `Node with id '${nodeId}' not found in workflow '${workflowId}'`, 404);
    }

    const claudeService = WorkflowService._claudeService || global.__claudeService;
    if (!claudeService) {
      throw new AppError('EXECUTION_ERROR', 'ClaudeService not initialized', 500);
    }

    const workspaceRoot = workflow.folderPath || FileService.getWorkspaceRoot() || process.cwd();
    const runId = `step_${generateId()}`;

    // Build input from upstream outputs
    const upstreamInputs = [];
    const incomingEdges = workflow.edges.filter(e => (e.target || e.to) === nodeId);
    for (const edge of incomingEdges) {
      const srcId = edge.source || edge.from;
      const sourceNode = workflow.nodes.find(n => n.id === srcId);
      if (sourceNode && sourceNode.output) {
        upstreamInputs.push(sourceNode.output);
      }
    }

    const nodeInput = upstreamInputs.length > 0
      ? upstreamInputs.join('\n---\n')
      : (typeof workflow.context?.workflowInput === 'string'
        ? workflow.context.workflowInput
        : JSON.stringify(workflow.context?.workflowInput || ''));

    // Build a minimal workflow with just this node for MasterAgentService prompt generation
    const minimalWorkflow = { ...workflow, nodes: [node] };
    const MasterAgentService = require('./MasterAgentService');
    const systemPrompt = MasterAgentService.buildSystemPrompt(minimalWorkflow, nodeInput, workspaceRoot);

    WorkflowModel.updateNodeStatus(workflowId, nodeId, 'running');
    WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);

    try {
      const output = await claudeService.execute(runId, null, nodeInput, {
        systemPrompt,
        model: 'sonnet',
        folderPath: workspaceRoot,
        workflowId,
        nodeId,
        runId,
      });

      WorkflowModel.updateNodeStatus(workflowId, nodeId, 'completed', output);
      WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);

      logger.info(`Step execution completed for node ${nodeId} in workflow ${workflowId}`);
      return { nodeId, input: nodeInput, output };
    } catch (err) {
      WorkflowModel.updateNodeStatus(workflowId, nodeId, 'failed', `Error: ${err.message}`);
      WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);
      throw new AppError('EXECUTION_ERROR', `Step execution failed for node '${nodeId}': ${err.message}`, 500);
    }
  }

  /**
   * Simulate workflow execution with mock data, without calling real Claude CLI
   * @param {string} workflowId
   * @param {Object} mockData - { [nodeId]: mockOutput, ... }
   * @returns {Promise<Object>} { results: { [nodeId]: output }, context }
   */
  static async simulate(workflowId, mockData = {}) {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
    }

    const nodes = workflow.nodes;
    const edges = workflow.edges;
    const nodeOutputs = new Map();

    // Build adjacency and indegree
    const adjacency = new Map();
    const indegree = new Map();
    const nodeMap = new Map();

    for (const node of nodes) {
      nodeMap.set(node.id, node);
      adjacency.set(node.id, []);
      indegree.set(node.id, 0);
    }

    for (const edge of edges) {
      const src = edge.source || edge.from;
      const tgt = edge.target || edge.to;
      if (src && tgt && adjacency.has(src) && indegree.has(tgt)) {
        adjacency.get(src).push(tgt);
        indegree.set(tgt, indegree.get(tgt) + 1);
      }
    }

    // Initial queue: all nodes with indegree 0
    let queue = [];
    for (const [nodeId, deg] of indegree) {
      if (deg === 0) queue.push(nodeId);
    }

    const results = {};

    while (queue.length > 0) {
      for (const nodeId of queue) {
        const node = nodeMap.get(nodeId);

        // Use mock data if provided, otherwise simulate output
        if (mockData[nodeId] !== undefined) {
          const output = typeof mockData[nodeId] === 'string'
            ? mockData[nodeId]
            : JSON.stringify(mockData[nodeId]);
          nodeOutputs.set(nodeId, output);
          results[nodeId] = output;
        } else {
          // Simulate based on node type
          const simulatedOutput = WorkflowService._simulateNode(node, nodeOutputs, workflow);
          nodeOutputs.set(nodeId, simulatedOutput);
          results[nodeId] = simulatedOutput;
        }
      }

      // Build next layer
      const nextQueue = [];
      for (const nodeId of queue) {
        for (const targetId of adjacency.get(nodeId) || []) {
          const newDegree = indegree.get(targetId) - 1;
          indegree.set(targetId, newDegree);
          if (newDegree === 0) {
            nextQueue.push(targetId);
          }
        }
      }
      queue = nextQueue;
    }

    logger.info(`Simulation completed for workflow ${workflowId}`);
    return { results, context: workflow.context || {} };
  }

  /**
   * Generate simulated output for a node without calling Claude CLI
   * @private
   */
  static _simulateNode(node, nodeOutputs, workflow) {
    switch (node.type) {
      case 'start':
        return workflow.context?.workflowInput
          ? (typeof workflow.context.workflowInput === 'string'
            ? workflow.context.workflowInput
            : JSON.stringify(workflow.context.workflowInput))
          : 'Simulation started';

      case 'end': {
        const upstreamOutputs = [];
        const directUpstream = (workflow?.edges || []).filter(e => e.target === node.id).map(e => e.source);
        for (const upId of directUpstream) {
          const out = nodeOutputs.get(upId);
          if (out) upstreamOutputs.push(out);
        }
        return upstreamOutputs.join('\n---\n') || 'Simulation completed';
      }

      case 'merge': {
        const mergeOutputs = [];
        const directUpstream = (workflow?.edges || []).filter(e => e.target === node.id).map(e => e.source);
        for (const upId of directUpstream) {
          const out = nodeOutputs.get(upId);
          if (out) mergeOutputs.push(out);
        }
        return mergeOutputs.join('\n---\n') || '[Simulated] Merge completed';
      }

      case 'condition': {
        const pattern = node.config?.pattern || '';
        const trueLabel = node.config?.trueLabel || '通过';
        const falseLabel = node.config?.falseLabel || '不通过';
        // In simulation, assume condition passes
        return `[Simulated] 条件判断 "${pattern}" → ${trueLabel}`;
      }

      case 'subworkflow':
        return `[Simulated] Subworkflow node "${node.label || node.id}" executed`;

      default:
        return `[Simulated] Node "${node.label || node.id}" executed`;
    }
  }

  /**
   * Test a single node with provided test input using Master Agent approach.
   * @param {string} workflowId
   * @param {string} nodeId
   * @param {*} testInput
   * @returns {Promise<Object>} { nodeId, input, output }
   */
  static async testNode(workflowId, nodeId, testInput) {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
    }

    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) {
      throw new AppError('NOT_FOUND', `Node with id '${nodeId}' not found in workflow '${workflowId}'`, 404);
    }

    const claudeService = WorkflowService._claudeService || global.__claudeService;
    if (!claudeService) {
      throw new AppError('EXECUTION_ERROR', 'ClaudeService not initialized', 500);
    }

    const workspaceRoot = workflow.folderPath || FileService.getWorkspaceRoot() || process.cwd();
    const runId = `test_${generateId()}`;
    const nodeInput = typeof testInput === 'string' ? testInput : JSON.stringify(testInput || '');

    // Build a minimal workflow with just this node for MasterAgentService prompt generation
    const minimalWorkflow = { ...workflow, nodes: [node] };
    const MasterAgentService = require('./MasterAgentService');
    const systemPrompt = MasterAgentService.buildSystemPrompt(minimalWorkflow, nodeInput, workspaceRoot);

    WorkflowModel.updateNodeStatus(workflowId, nodeId, 'running');
    WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);

    try {
      const output = await claudeService.execute(runId, null, nodeInput, {
        systemPrompt,
        model: 'sonnet',
        folderPath: workspaceRoot,
        workflowId,
        nodeId,
        runId,
      });

      WorkflowModel.updateNodeStatus(workflowId, nodeId, 'completed', output);
      WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);

      logger.info(`Node test completed for node ${nodeId} in workflow ${workflowId}`);
      return { nodeId, input: nodeInput, output };
    } catch (err) {
      WorkflowModel.updateNodeStatus(workflowId, nodeId, 'failed', `Error: ${err.message}`);
      WorkflowService._broadcastNodeUpdate(workflowId, runId, nodeId);
      throw new AppError('EXECUTION_ERROR', `Node test failed for '${nodeId}': ${err.message}`, 500);
    }
  }

  /**
   * Get all node outputs and shared context variables for a workflow
   * @param {string} workflowId
   * @returns {Object} { nodes: { [nodeId]: { status, output } }, context }
   */
  static getVariables(workflowId) {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
    }

    const nodes = {};
    for (const node of workflow.nodes) {
      nodes[node.id] = {
        label: node.label || node.id,
        type: node.type,
        status: node.status || 'pending',
        output: node.output || null
      };
    }

    return {
      nodes,
      context: workflow.context || {}
    };
  }

  /**
   * Batch execute a workflow with multiple parameter sets (sequential).
   * Uses execute() and polls WorkflowModel for executionStatus changes.
   * @param {string} workflowId
   * @param {Array} paramsArray - Array of { input, params } objects
   * @returns {Promise<Array>} Array of { runId, status, input, params } results
   */
  static async batchExecute(workflowId, paramsArray) {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
    }

    if (!Array.isArray(paramsArray) || paramsArray.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'paramsArray must be a non-empty array', 400);
    }

    const results = [];

    for (const params of paramsArray) {
      try {
        const { runId } = WorkflowService.execute(workflowId, params.input, params.params);

        // Wait for the execution to finish by polling executionStatus
        await WorkflowService._waitForMasterCompletion(workflowId, 300000);

        results.push({
          runId,
          status: 'completed',
          input: params.input,
          params: params.params
        });
      } catch (err) {
        results.push({
          runId: null,
          status: 'failed',
          error: err.message,
          input: params.input,
          params: params.params
        });
      }
    }

    logger.info(`Batch execution completed for workflow ${workflowId} with ${paramsArray.length} parameter sets`);
    return results;
  }

  /**
   * Resume workflow execution from a checkpoint.
   * Always uses Master Agent mode via execute().
   * @param {string} workflowId
   * @param {Object} checkpoint - The checkpoint data
   * @returns {{ runId: string, status: string }}
   */
  static resumeFromCheckpoint(workflowId, checkpoint) {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${workflowId}' not found`, 404);
    }

    if (!checkpoint || !checkpoint.runId) {
      throw new AppError('VALIDATION_ERROR', '无效的检查点数据', 400);
    }

    logger.info(`Workflow resume from checkpoint: ${workflowId}`, { checkpointRunId: checkpoint.runId });

    const { runId } = WorkflowService.execute(workflowId, checkpoint.workflowInput, {
      __resumeFromCheckpoint: true,
      __checkpointRunId: checkpoint.runId
    });

    return { runId, status: 'running' };
  }

  /**
   * Skip a failed node and continue workflow execution.
   * Always uses Master Agent mode via execute().
   * @param {string} workflowId
   * @param {string} nodeId - The failed node to skip
   * @returns {{ runId: string, status: string, skippedNode: string }}
   */
  static skipNodeAndContinue(workflowId, nodeId) {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow '${workflowId}' not found`, 404);
    }

    const node = workflow.nodes?.find(n => n.id === nodeId);
    if (!node) {
      throw new AppError('NOT_FOUND', `Node '${nodeId}' not found in workflow`, 404);
    }

    if (node.status !== 'failed') {
      throw new AppError('VALIDATION_ERROR', `Node '${nodeId}' is not in failed status (current: ${node.status})`, 400);
    }

    // Mark the node as skipped
    WorkflowModel.updateNodeStatus(workflowId, nodeId, 'skipped', 'Skipped by user');
    WorkflowService._broadcastNodeUpdate(workflowId, workflow.currentRunId, nodeId);

    logger.info(`Workflow skip-node and continue: ${workflowId}`, { skippedNode: nodeId });

    const { runId } = WorkflowService.execute(workflowId, workflow.context?.lastInput || '', {
      __skipNode: nodeId
    });

    return { runId, status: 'running', skippedNode: nodeId };
  }

  /**
   * Poll WorkflowModel for executionStatus changes (used by batchExecute).
   * Checks every 2 seconds until executionStatus is no longer 'running'.
   * @param {string} workflowId
   * @param {number} [timeoutMs=300000] - Max wait time (default 5 min)
   * @returns {Promise<void>}
   */
  static async _waitForMasterCompletion(workflowId, timeoutMs = 300000) {
    const startTime = Date.now();
    while (true) {
      const workflow = WorkflowModel.findById(workflowId);
      if (!workflow) {
        throw new Error('Workflow not found');
      }

      if (workflow.executionStatus !== 'running' && workflow.executionStatus !== 'paused') {
        if (workflow.executionStatus === 'failed') {
          throw new Error('Execution failed');
        }
        return; // completed or stopped
      }

      if (Date.now() - startTime > timeoutMs) {
        throw new Error('Execution timed out');
      }

      await new Promise(r => setTimeout(r, 2000));
    }
  }

  /**
   * Stop a running workflow - sets status to stopped and rejects pending promises
   */
  static stop(id) {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }
    if (workflow.executionStatus !== 'running' && workflow.executionStatus !== 'paused') {
      throw new AppError('CONFLICT', '只能停止运行中或已暂停的工作流', 409);
    }

    WorkflowModel.update(id, { status: 'stopped', executionStatus: 'stopped' });

  }

  /**
   * Broadcast node status update via BroadcastService
   */
  static _broadcastNodeUpdate(workflowId, runId, nodeId) {
    const broadcastService = WorkflowService._broadcastService;
    if (!broadcastService) return;

    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) return;

    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) return;

    broadcastService.broadcast('workflow.nodeUpdate', {
      workflowId,
      workspaceId: workflow.workspaceId || null,
      runId,
      nodeId: node.id,
      label: node.label,
      status: node.status,
      output: node.output,
      startedAt: node.startedAt,
      completedAt: node.completedAt
    });
  }

  /**
   * Broadcast workflow status update via BroadcastService
   */
  static _broadcastStatusUpdate(workflowId, status, runId, summary) {
    const broadcastService = WorkflowService._broadcastService;
    if (!broadcastService) return;

    const workflow = WorkflowModel.findById(workflowId);
    const workspaceId = workflow?.workspaceId || null;
    const workflowName = workflow?.name || null;

    broadcastService.broadcast('workflow.statusUpdate', {
      workflowId,
      workflowName,
      workspaceId,
      status,
      runId,
      executionStatus: status,
      summary: summary || null
    });
  }

  /**
   * Calculate execution progress percentage
   */
  static _calculateProgress(workflowId) {
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) return 0;
    const workNodes = workflow.nodes.filter(n => n.type !== 'start' && n.type !== 'end');
    if (workNodes.length === 0) return 0;
    const completed = workNodes.filter(n => n.status === 'completed').length;
    return Math.round((completed / workNodes.length) * 100);
  }

  /**
   * Pause workflow
   */
  static pause(id) {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }
    if (workflow.executionStatus !== 'running') {
      throw new AppError('CONFLICT', '只能暂停运行中的工作流', 409);
    }

    // Abort the SDK loop immediately (finishes current API call, then stops)
    const sdkService = global.__sdkService;
    if (sdkService && workflow.currentRunId) {
      sdkService.pause(`${workflow.currentRunId}_master`);
    }
    WorkflowModel.update(id, { status: 'paused', executionStatus: 'paused' });
    WorkflowService._broadcastStatusUpdate(id, 'paused', workflow.currentRunId);
    logger.info(`Workflow paused: ${id}`);
    return { status: 'paused' };
  }

  /**
   * Resume workflow
   */
  static resume(id) {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }
    if (workflow.executionStatus !== 'paused') {
      throw new AppError('CONFLICT', '只能恢复已暂停的工作流', 409);
    }

    WorkflowModel.update(id, { status: 'running', executionStatus: 'running' });
    WorkflowService._broadcastStatusUpdate(id, 'running', workflow.currentRunId);
    logger.info(`Workflow resumed: ${id}`);
    return { status: 'running' };
  }

  /**
   * Get workflow execution status (simple)
   */
  static getStatus(id) {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }

    const latestRun = workflow.executionLog.length > 0
      ? workflow.executionLog[workflow.executionLog.length - 1]
      : null;

    let progress = 0;
    let currentNodeId = null;

    if (latestRun && latestRun.nodeResults.length > 0) {
      const workResults = latestRun.nodeResults.filter(nr => {
        const n = workflow.nodes.find(nd => nd.id === nr.nodeId);
        return n && n.type !== 'start' && n.type !== 'end';
      });
      progress = workResults.length > 0
        ? Math.round((workResults.filter(n => n.status === 'completed').length / workResults.length) * 100)
        : 0;
      const runningNode = latestRun.nodeResults.find(n => n.status === 'running');
      if (runningNode) {
        currentNodeId = runningNode.nodeId;
      }
    }

    return {
      status: workflow.status,
      currentNodeId,
      progress,
      runId: latestRun ? latestRun.runId : null
    };
  }

  /**
   * Set the working folder for a workflow
   */
  static setFolder(id, folderPath) {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }

    // Validate folderPath is a non-empty string
    if (!folderPath || typeof folderPath !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'folderPath must be a non-empty string', 400);
    }

    const fs = require('fs');
    const path = require('path');
    const resolved = path.resolve(folderPath);
    if (!fs.existsSync(resolved)) {
      throw new AppError('NOT_FOUND', `Directory does not exist: ${folderPath}`, 404);
    }
    if (!fs.statSync(resolved).isDirectory()) {
      throw new AppError('VALIDATION_ERROR', '路径不是目录', 400);
    }

    const updated = WorkflowModel.update(id, { folderPath: resolved });
    logger.info(`Workflow folder set: ${id}`, { folderPath: resolved });
    return updated;
  }

  /**
   * Clear the working folder for a workflow (make it global)
   */
  static clearFolder(id) {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }
    const updated = WorkflowModel.update(id, { folderPath: null });
    logger.info(`Workflow folder cleared: ${id}`);
    return updated;
  }

  /**
   * Get detailed execution status for a workflow
   */
  static getExecutionStatus(id) {
    const workflow = WorkflowModel.findById(id);
    if (!workflow) {
      throw new AppError('NOT_FOUND', `Workflow with id '${id}' not found`, 404);
    }

    if (!workflow.currentRunId || workflow.executionStatus === 'idle') {
      return {
        workflowId: id,
        runId: null,
        status: 'idle',
        startedAt: null,
        completedAt: null,
        progress: 0,
        nodes: workflow.nodes.map(n => ({
          nodeId: n.id,
          label: n.label || n.id,
          type: n.type,
          agentId: n.agentId || null,
          status: n.status || 'pending',
          output: n.output || null,
          startedAt: n.startedAt || null,
          completedAt: n.completedAt || null,
          logs: n.logs || []
        })),
        edges: (workflow.edges || []).map(e => ({
          source: e.source,
          target: e.target
        }))
      };
    }

    const latestRun = workflow.executionLog.find(e => e.runId === workflow.currentRunId)
      || workflow.executionLog[workflow.executionLog.length - 1];

    if (!latestRun) {
      return {
        workflowId: id,
        runId: null,
        status: 'idle',
        startedAt: null,
        completedAt: null,
        progress: 0,
        nodes: workflow.nodes.map(n => ({
          nodeId: n.id,
          label: n.label || n.id,
          type: n.type,
          agentId: n.agentId || null,
          status: n.status || 'pending',
          output: null,
          startedAt: null,
          completedAt: null,
          logs: []
        })),
        edges: (workflow.edges || []).map(e => ({
          source: e.source,
          target: e.target
        }))
      };
    }

    const workNodes = workflow.nodes.filter(n => n.type !== 'start' && n.type !== 'end');
    const completedCount = workNodes.filter(n => n.status === 'completed').length;
    const progress = workNodes.length > 0
      ? Math.round((completedCount / workNodes.length) * 100)
      : 0;

    return {
      workflowId: id,
      runId: latestRun.runId,
      status: workflow.executionStatus,
      startedAt: latestRun.startedAt,
      completedAt: latestRun.completedAt,
      progress,
      nodes: workflow.nodes.map(n => ({
        nodeId: n.id,
        label: n.label || n.id,
        type: n.type,
        agentId: n.agentId || null,
        status: n.status || 'pending',
        output: n.output || null,
        startedAt: n.startedAt || null,
        completedAt: n.completedAt || null,
        logs: n.logs || []
      })),
      edges: (workflow.edges || []).map(e => ({
        source: e.source,
        target: e.target
      }))
    };
  }
}

module.exports = WorkflowService;
