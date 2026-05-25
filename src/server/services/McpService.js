const { generateId } = require('../utils/id');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const MCP_BACKUP_DIR = path.join(config.data.dir, 'mcp');

if (!fs.existsSync(MCP_BACKUP_DIR)) {
  fs.mkdirSync(MCP_BACKUP_DIR, { recursive: true });
}

const BUILTIN_MCP = [];

class McpService {
  /** @type {Map<string, Object>} Custom MCP tools */
  static customTools = new Map();

  /** @type {Map<string, string[]>} mcpId -> [agentId, ...] */
  static installations = new Map();

  /**
   * Get all MCP tools (built-in + custom)
   * @returns {Array} List of all MCP tools
   */
  static getAll() {
    return [...BUILTIN_MCP, ...McpService.customTools.values()];
  }

  /**
   * Get a single MCP tool by ID
   * @param {string} id - MCP tool ID
   * @returns {Object|null} MCP tool object or null
   */
  static getById(id) {
    const builtin = BUILTIN_MCP.find(m => m.id === id);
    if (builtin) return builtin;
    return McpService.customTools.get(id) || null;
  }

  /**
   * Create a custom MCP tool
   * @param {Object} data - MCP tool data
   * @returns {Object} Created MCP tool
   */
  static create(data) {
    const tool = {
      id: generateId(),
      name: data.name,
      category: data.category || '自定义',
      description: data.description || '',
      isBuiltin: false,
      endpoint: data.endpoint || '',
      auth: data.auth || {},
      createdAt: new Date().toISOString()
    };
    McpService.customTools.set(tool.id, tool);
    return tool;
  }

  /**
   * Install an MCP tool to an agent (or all agents)
   * @param {string} mcpId - MCP tool ID
   * @param {string} agentId - Agent ID (ignored when installAll is true)
   * @param {Object} [options={}] - Options
   * @param {boolean} [options.installAll] - Install to all agents
   * @returns {Object} Installation result
   */
  static install(mcpId, agentId, options = {}) {
    let mcp = McpService.getById(mcpId);
    // Accept MCP tools from the frontend market even if not in server's built-in list
    if (!mcp) {
      mcp = McpService.customTools.get(mcpId);
      if (!mcp) {
        mcp = { id: mcpId, name: mcpId, category: 'market', description: '', isBuiltin: false };
        McpService.customTools.set(mcpId, mcp);
      }
    }

    // Backup MCP tool to disk
    McpService._backupMcp(mcp);

    if (options.installAll) {
      const AgentService = require('./AgentService');
      const { items: allAgents } = AgentService.list({ page: 1, limit: 9999 });
      const results = [];
      for (const agent of allAgents) {
        if (!McpService.installations.has(mcpId)) {
          McpService.installations.set(mcpId, []);
        }
        const agents = McpService.installations.get(mcpId);
        if (!agents.includes(agent.id)) {
          agents.push(agent.id);
          results.push(agent.id);
        }
      }

      // Persist to workspace if active
      McpService.saveInstallations();

      return { mcpId, installAll: true, agentIds: results, installed: true };
    }

    if (!McpService.installations.has(mcpId)) {
      McpService.installations.set(mcpId, []);
    }

    const agents = McpService.installations.get(mcpId);
    if (agents.includes(agentId)) {
      const err = new Error(`MCP tool '${mcpId}' is already installed for agent '${agentId}'`);
      err.code = 'CONFLICT';
      throw err;
    }

    agents.push(agentId);

    // Persist to workspace if active
    McpService.saveInstallations();

    return { mcpId, agentId, installed: true };
  }

  /**
   * Uninstall an MCP tool from an agent
   * @param {string} mcpId - MCP tool ID
   * @param {string} agentId - Agent ID
   * @returns {Object} Uninstallation result
   */
  static uninstall(mcpId, agentId) {
    if (!McpService.installations.has(mcpId)) {
      const err = new Error(`MCP tool '${mcpId}' not found`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const agents = McpService.installations.get(mcpId);
    const idx = agents.indexOf(agentId);
    if (idx === -1) {
      const err = new Error(`MCP tool '${mcpId}' is not installed for agent '${agentId}'`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    agents.splice(idx, 1);

    // Persist to workspace if active
    McpService.saveInstallations();

    return { mcpId, agentId, installed: false };
  }

  /**
   * Get all MCP tools installed for a specific agent
   * @param {string} agentId - Agent ID
   * @returns {Array} List of MCP tools installed for the agent
   */
  static getByAgent(agentId) {
    const result = [];
    const allTools = McpService.getAll();
    for (const tool of allTools) {
      const agents = McpService.installations.get(tool.id) || [];
      if (agents.includes(agentId)) {
        result.push(tool);
      }
    }
    return result;
  }

  /**
   * Backup MCP tool info to disk for later use by new agents
   */
  static _backupMcp(mcp) {
    try {
      if (!fs.existsSync(MCP_BACKUP_DIR)) {
        fs.mkdirSync(MCP_BACKUP_DIR, { recursive: true });
      }
      const backupFile = path.join(MCP_BACKUP_DIR, `${mcp.id}.json`);
      fs.writeFileSync(backupFile, JSON.stringify(mcp, null, 2), 'utf-8');
    } catch (e) {
      console.error(`Failed to backup MCP ${mcp.id}:`, e.message);
    }
  }

  /**
   * Get all backed-up MCP tool IDs for auto-assignment to new agents
   */
  static getBackedUpTools() {
    try {
      if (!fs.existsSync(MCP_BACKUP_DIR)) return [];
      const files = fs.readdirSync(MCP_BACKUP_DIR).filter(f => f.endsWith('.json'));
      return files.map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(MCP_BACKUP_DIR, f), 'utf-8'));
          return data.id;
        } catch { return null; }
      }).filter(Boolean);
    } catch { return []; }
  }

  /**
   * Assign all backed-up MCP tools to a newly created agent
   */
  static assignToNewAgent(agentId) {
    const backedUp = McpService.getBackedUpTools();
    for (const mcpId of backedUp) {
      if (!McpService.installations.has(mcpId)) {
        McpService.installations.set(mcpId, []);
      }
      const agents = McpService.installations.get(mcpId);
      if (!agents.includes(agentId)) {
        agents.push(agentId);
      }
    }
    return backedUp;
  }

  /**
   * Reload installed MCP tools from a saved state.
   * @param {Array<{mcpId: string, agentIds: string[]}>} installedArray
   */
  static reload(installedArray) {
    McpService.installations.clear();
    if (Array.isArray(installedArray)) {
      for (const entry of installedArray) {
        if (entry && entry.mcpId && Array.isArray(entry.agentIds)) {
          McpService.installations.set(entry.mcpId, [...entry.agentIds]);
        }
      }
    }
  }

  /**
   * Get current installations as a serializable array.
   * @returns {Array<{mcpId: string, agentIds: string[]}>}
   */
  static saveInstallations() {
    const result = [];
    for (const [mcpId, agentIds] of McpService.installations) {
      result.push({ mcpId, agentIds: [...agentIds] });
    }

    // Persist to workspace if active, otherwise to global data/
    try {
      const FileService = require('./FileService');
      const workspaceRoot = FileService.runtimeWorkspaceRoot;
      if (workspaceRoot) {
        const WorkspaceStateService = require('./WorkspaceStateService');
        WorkspaceStateService.saveState(workspaceRoot, 'mcp-tools', { installed: result });
      } else {
        const dataDir = path.join(config.data.dir, 'mcp-tools.json');
        fs.writeFileSync(dataDir, JSON.stringify({ installed: result }, null, 2), 'utf-8');
      }
    } catch (e) {
      // Silently ignore
    }

    return result;
  }

  /**
   * Clear custom tools and installations (for testing)
   */
  static clear() {
    McpService.customTools.clear();
    McpService.installations.clear();
  }
}

module.exports = McpService;
