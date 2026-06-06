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
savedAgents.forEach((agent: any) => {
  agents.set(agent.id, agent);
});

/**
 * Agent Model - In-memory CRUD operations
 */
class AgentModel {
  static _persistPending: boolean = false;

  static create(data: any): any {
    const now = new Date();
    const agent: any = {
      id: generateId(),
      name: data.name,
      role: data.role,
      description: data.description || '',
      status: 'idle',
      workspaceId: data.workspaceId !== undefined ? data.workspaceId : null,
      parentAgentId: data.parentAgentId || null,
      config: {
        model: data.config?.model || config.agent.defaultModel,
        systemPrompt: data.config?.systemPrompt || '',
        temperature: data.config?.temperature ?? config.agent.defaultTemperature
      },
      toolPermissions: data.toolPermissions || {
        executeCommand: true, browser: true, search: true
      },
      mcpBindings: data.mcpBindings || [],
      skillNames: data.skillNames || [],
      skillPackages: data.skillPackages || [],
      logs: [],
      createdAt: now,
      updatedAt: now
    };

    if (data.workspaceId === undefined) {
      try {
        const WorkspaceManager = require('../services/WorkspaceManager');
        const active = WorkspaceManager.getActive();
        if (active.length > 0) {
          agent.workspaceId = active[active.length - 1].id;
        }
      } catch (e) { /* ignore */ }
    }

    agents.set(agent.id, agent);
    this._persist();
    return { ...agent };
  }

  static findAll({ status, role, page = 1, limit = 20 }: any = {}): any {
    let results = Array.from(agents.values());
    if (status) results = results.filter((a: any) => a.status === status);
    if (role) results = results.filter((a: any) => a.role === role);

    const total = results.length;
    const start = (page - 1) * limit;
    const paginated = results.slice(start, start + limit);

    return {
      items: paginated.map((a: any) => ({ ...a })),
      total,
      page,
      limit
    };
  }

  static findById(id: string): any {
    const agent = agents.get(id);
    return agent ? { ...agent } : null;
  }

  static findByParentId(parentId: string): any[] {
    const results: any[] = [];
    for (const agent of agents.values()) {
      if (agent.parentAgentId === parentId) {
        results.push({ ...agent });
      }
    }
    return results;
  }

  static update(id: string, data: any): any {
    const agent = agents.get(id);
    if (!agent) return null;

    if (data.name !== undefined) agent.name = data.name;
    if (data.role !== undefined) agent.role = data.role;
    if (data.description !== undefined) agent.description = data.description;
    if (data.status !== undefined) agent.status = data.status;
    if (data.workspaceId !== undefined) agent.workspaceId = data.workspaceId;
    if (data.parentAgentId !== undefined) agent.parentAgentId = data.parentAgentId;
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

  static delete(id: string): boolean {
    const agent = agents.get(id);
    if (!agent) return false;
    agents.delete(id);
    this._persist();
    return true;
  }

  static exists(id: string): boolean {
    return agents.has(id);
  }

  static addLog(id: string, level: string, message: string): any {
    const agent = agents.get(id);
    if (!agent) return null;

    const logEntry = {
      timestamp: new Date(),
      level,
      message
    };
    agent.logs.push(logEntry);

    if (agent.logs.length > config.agent.maxLogs) {
      agent.logs = agent.logs.slice(-config.agent.maxLogs);
    }

    agent.updatedAt = new Date();
    this._persist();
    return logEntry;
  }

  static getLogs(id: string, limit = 50): any[] | null {
    const agent = agents.get(id);
    if (!agent) return null;
    return agent.logs.slice(-limit);
  }

  static _removeFromMap(workspaceId: string): void {
    for (const [id, a] of agents.entries()) {
      if (a.workspaceId === workspaceId) {
        agents.delete(id);
      }
    }
  }

  static clear(): void {
    agents.clear();
  }

  static count(): number {
    return agents.size;
  }

  static reload(agentArray: any[]): void {
    if (!Array.isArray(agentArray)) return;
    agentArray.forEach((agent: any) => {
      if (agent && agent.id) {
        agents.set(agent.id, agent);
      }
    });
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
    const data = Array.from(agents.values());
    try {
      dataStore.saveAsync(data);
    } catch (e: any) {
      const logger = require('../utils/logger');
      logger.error(`Failed to persist agents: ${e.message}`);
    }
  }

  static _doPersistSync(): void {
    this._persistPending = false;
    try {
      dataStore.save(Array.from(agents.values()));
    } catch (e: any) {
      const logger = require('../utils/logger');
      logger.error(`Failed to persist agents: ${e.message}`);
    }
  }
}

AgentModel._persistPending = false;

module.exports = AgentModel;
