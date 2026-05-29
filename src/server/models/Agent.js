const path = require('path');
const fs = require('fs');
const { generateId } = require('../utils/id');
const config = require('../config');
const DataStore = require('../utils/DataStore');
const { atomicWriteSync, atomicWriteAsync } = require('../utils/atomicWrite');

// DataStore for persistence
const dataStore = new DataStore(
  path.join(config.data.dir, config.data.agentsFile)
);

// In-memory store, loaded from file on startup
const agents = new Map();
const savedAgents = dataStore.load();
savedAgents.forEach(agent => {
  agents.set(agent.id, agent);
});

/**
 * Agent Model - In-memory CRUD operations
 */
class AgentModel {
  /**
   * Create a new agent
   */
  static create(data) {
    const now = new Date();
    const agent = {
      id: generateId(),
      name: data.name,
      role: data.role,
      description: data.description || '',
      status: 'idle',
      workspaceId: data.workspaceId !== undefined ? data.workspaceId : null,
      config: {
        model: data.config?.model || config.agent.defaultModel,
        systemPrompt: data.config?.systemPrompt || '',
        temperature: data.config?.temperature ?? config.agent.defaultTemperature
      },
      toolPermissions: data.toolPermissions || {
        executeCommand: true, browser: true, search: true
      },
      mcpBindings: data.mcpBindings || [],
      skillNames: data.skillNames || [],     // Globally installed Skills this Agent uses
      skillPackages: data.skillPackages || [],
      logs: [],
      createdAt: now,
      updatedAt: now
    };

    // 自动标记 workspaceId：仅在 data 中完全未传 workspaceId 字段时自动标记
    // 如果显式传了 workspaceId（包括 null），则尊重调用方的设置
    if (data.workspaceId === undefined) {
      try {
        const WorkspaceManager = require('../services/WorkspaceManager');
        const active = WorkspaceManager.getActive();
        if (active.length > 0) {
          agent.workspaceId = active[active.length - 1].id;
        }
      } catch (e) { /* 忽略，保持 workspaceId 为 null */ }
    }

    agents.set(agent.id, agent);
    this._persist();
    return { ...agent };
  }

  /**
   * Find all agents with optional filters
   */
  static findAll({ status, role, page = 1, limit = 20 } = {}) {
    let results = Array.from(agents.values());

    if (status) {
      results = results.filter(a => a.status === status);
    }
    if (role) {
      results = results.filter(a => a.role === role);
    }

    const total = results.length;
    const start = (page - 1) * limit;
    const paginated = results.slice(start, start + limit);

    return {
      items: paginated.map(a => ({ ...a })),
      total,
      page,
      limit
    };
  }

  /**
   * Find agent by ID
   */
  static findById(id) {
    const agent = agents.get(id);
    return agent ? { ...agent } : null;
  }

  /**
   * Update agent
   */
  static update(id, data) {
    const agent = agents.get(id);
    if (!agent) return null;

    if (data.name !== undefined) agent.name = data.name;
    if (data.role !== undefined) agent.role = data.role;
    if (data.description !== undefined) agent.description = data.description;
    if (data.status !== undefined) agent.status = data.status;
    if (data.workspaceId !== undefined) agent.workspaceId = data.workspaceId;
    if (data.config) {
      if (data.config.model !== undefined) agent.config.model = data.config.model;
      if (data.config.systemPrompt !== undefined) agent.config.systemPrompt = data.config.systemPrompt;
      if (data.config.temperature !== undefined) agent.config.temperature = data.config.temperature;
    }
    if (data.toolPermissions !== undefined) agent.toolPermissions = data.toolPermissions;
    if (data.mcpBindings !== undefined) agent.mcpBindings = data.mcpBindings;
    if (data.skillNames !== undefined) agent.skillNames = data.skillNames;
    if (data.skillPackages !== undefined) agent.skillPackages = data.skillPackages;
    agent.updatedAt = new Date();
    this._persist();

    return { ...agent };
  }

  /**
   * Delete agent
   */
  static delete(id) {
    const agent = agents.get(id);
    if (!agent) return false;
    agents.delete(id);
    this._persist();
    return true;
  }

  /**
   * Check if agent exists
   */
  static exists(id) {
    return agents.has(id);
  }

  /**
   * Add log entry to agent
   */
  static addLog(id, level, message) {
    const agent = agents.get(id);
    if (!agent) return null;

    const logEntry = {
      timestamp: new Date(),
      level,
      message
    };
    agent.logs.push(logEntry);

    // Cap logs at max
    if (agent.logs.length > config.agent.maxLogs) {
      agent.logs = agent.logs.slice(-config.agent.maxLogs);
    }

    agent.updatedAt = new Date();
    this._persist();
    return logEntry;
  }

  /**
   * Get agent logs
   */
  static getLogs(id, limit = 50) {
    const agent = agents.get(id);
    if (!agent) return null;
    return agent.logs.slice(-limit);
  }

  /**
   * Clear all agents (for testing)
   */
  /**
   * 从内存 Map 中移除指定工作区的所有条目（不触发磁盘写入）
   */
  static _removeFromMap(workspaceId) {
    for (const [id, a] of agents.entries()) {
      if (a.workspaceId === workspaceId) {
        agents.delete(id);
      }
    }
  }

  static clear() {
    agents.clear();
  }

  /**
   * Get count of agents
   */
  static count() {
    return agents.size;
  }

  /**
   * Reload agents from an array (e.g. loaded from workspace WORKFLOWS folder).
   * Does NOT trigger persistence.
   * @param {Array} agentArray - Array of agent objects
   */
  static reload(agentArray) {
    if (!Array.isArray(agentArray)) return;

    // Merge incoming entries: add/update, but don't remove existing in-memory items
    agentArray.forEach(agent => {
      if (agent && agent.id) {
        agents.set(agent.id, agent);
      }
    });
  }

  /**
   * Persist current data to file.
   * If a workspace is active, writes to <workspace>/WORKFLOWS/agents.json,
   * otherwise falls back to the global data/agents.json.
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
    // 智能体始终存储在安装目录，不跟随工作区
    this._persistPending = false;
    const data = Array.from(agents.values());
    try {
      dataStore.saveAsync(data);
    } catch (e) {
      const logger = require('../utils/logger');
      logger.error(`Failed to persist agents: ${e.message}`);
    }
  }

  static _doPersistSync() {
    // 智能体始终存储在安装目录
    this._persistPending = false;
    try {
      dataStore.save(Array.from(agents.values()));
    } catch (e) {
      const logger = require('../utils/logger');
      logger.error(`Failed to persist agents: ${e.message}`);
    }
  }

}

// Initialize debounce flag
AgentModel._persistPending = false;

module.exports = AgentModel;
