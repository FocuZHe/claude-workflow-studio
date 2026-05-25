const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { atomicWriteSync, atomicWriteAsync } = require('../utils/atomicWrite');

const WORKFLOWS_DIR = 'WORKFLOWS';
const HISTORY_FILE = path.join(config.data.dir, 'workspace-history.json');
const MAX_HISTORY = 10;

/** Debounce timers keyed by filePath */
const _debounceTimers = new Map();
/** Pending write data keyed by filePath (for flush on shutdown) */
const _pendingWrites = new Map();

/**
 * WorkspaceStateService - Manages workspace state persistence
 */
class WorkspaceStateService {
  /**
   * Ensure the WORKFLOWS folder exists under the workspace path,
   * and initialize default JSON files if missing.
   * @param {string} workspacePath - Absolute path to the workspace root
   */
  static ensureWorkflowsFolder(workspacePath) {
    const backupDir = path.join(workspacePath, '.BACKUP');
    const wfDir = path.join(workspacePath, WORKFLOWS_DIR);

    // 恢复所有需要的目录
    const dirsToRestore = ['WORKFLOWS', 'reports', '.context'];
    for (const dir of dirsToRestore) {
      const targetDir = path.join(workspacePath, dir);
      if (!fs.existsSync(targetDir)) {
        const backupSrc = path.join(backupDir, dir);
        if (fs.existsSync(backupSrc)) {
          try {
            fs.cpSync(backupSrc, targetDir, { recursive: true });
            logger.info(`Restored from backup: ${dir}`);
          } catch (e) {
            if (dir === 'WORKFLOWS') {
              fs.mkdirSync(targetDir, { recursive: true });
            }
            logger.warn(`Failed to restore ${dir}: ${e.message}`);
          }
        } else if (dir === 'WORKFLOWS') {
          fs.mkdirSync(targetDir, { recursive: true });
          logger.info(`WORKFLOWS folder created at: ${targetDir}`);
        }
      }
    }

    const defaults = {
      'manifest.json': JSON.stringify({
        workspacePath,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, null, 2),
      'workflows.json': JSON.stringify([], null, 2),
      'skills.json': JSON.stringify({ installed: [] }, null, 2),
      'mcp-tools.json': JSON.stringify({ installed: [] }, null, 2),
      'execution-log.json': JSON.stringify([], null, 2),
      'chat-sessions.json': JSON.stringify([], null, 2),
      'prompt-templates.json': JSON.stringify([], null, 2)
    };

    for (const [filename, content] of Object.entries(defaults)) {
      const filePath = path.join(wfDir, filename);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content, 'utf-8');
        logger.info(`Default file created: ${filePath}`);
      }
    }
  }

  /**
   * Backup workspace data (WORKFLOWS, reports, .context) to .BACKUP
   * @param {string} workspacePath - Absolute path to the workspace root
   */
  static backupWorkflowsFolder(workspacePath) {
    try {
      const backupDir = path.join(workspacePath, '.BACKUP');
      if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true });
      }
      fs.mkdirSync(backupDir, { recursive: true });

      // 备份的目录列表
      const dirsToBackup = ['WORKFLOWS', 'reports', '.context'];
      for (const dir of dirsToBackup) {
        const srcDir = path.join(workspacePath, dir);
        if (fs.existsSync(srcDir)) {
          const destDir = path.join(backupDir, dir);
          fs.cpSync(srcDir, destDir, { recursive: true });
          logger.info(`Backed up: ${dir}`);
        }
      }
    } catch (e) {
      logger.warn(`Failed to backup workspace: ${e.message}`);
    }
  }

  /**
   * Load all state from the WORKFLOWS folder.
   * @param {string} workspacePath - Absolute path to the workspace root
   * @returns {Object} State object with keys: manifest, workflows, agents, skills, mcpTools, executionLog
   */
  static loadState(workspacePath) {
    const wfDir = path.join(workspacePath, WORKFLOWS_DIR);

    if (!fs.existsSync(wfDir)) {
      return null;
    }

    const readJson = (filename) => {
      const filePath = path.join(wfDir, filename);
      try {
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
      } catch (e) {
        logger.error(`Failed to load ${filename} from ${wfDir}: ${e.message}`);
        return null;
      }
    };

    return {
      manifest: readJson('manifest.json'),
      workflows: readJson('workflows.json'),
      agents: readJson('agents.json'),
      chatSessions: readJson('chat-sessions.json'),
      promptTemplates: readJson('prompt-templates.json'),
      skills: readJson('skills.json'),
      mcpTools: readJson('mcp-tools.json'),
      executionLog: readJson('execution-log.json')
    };
  }

  /**
   * Save state to a specific JSON file in the WORKFLOWS folder, with debounce (500ms).
   * @param {string} workspacePath - Absolute path to the workspace root
   * @param {string} stateType - One of: manifest, workflows, agents, skills, mcp-tools, execution-log
   * @param {*} data - The data to serialize and save
   */
  static saveState(workspacePath, stateType, data) {
    const fileMap = {
      manifest: 'manifest.json',
      workflows: 'workflows.json',
      agents: 'agents.json',
      skills: 'skills.json',
      'mcp-tools': 'mcp-tools.json',
      'execution-log': 'execution-log.json',
      'chat-sessions': 'chat-sessions.json',
      'prompt-templates': 'prompt-templates.json'
    };

    const filename = fileMap[stateType];
    if (!filename) {
      logger.warn(`Unknown state type: ${stateType}`);
      return;
    }

    const filePath = path.join(workspacePath, WORKFLOWS_DIR, filename);

    // Debounce: clear existing timer for this file
    if (_debounceTimers.has(filePath)) {
      clearTimeout(_debounceTimers.get(filePath));
    }

    // Keep pending data for flush on shutdown
    _pendingWrites.set(filePath, JSON.stringify(data, null, 2));

    const timer = setTimeout(async () => {
      try {
        await atomicWriteAsync(filePath, _pendingWrites.get(filePath) || JSON.stringify(data, null, 2));
        _debounceTimers.delete(filePath);
        _pendingWrites.delete(filePath);
      } catch (e) {
        logger.error(`Failed to save state to ${filePath}: ${e.message}`);
        _debounceTimers.delete(filePath);
        _pendingWrites.delete(filePath);
      }
    }, 500);

    _debounceTimers.set(filePath, timer);
  }

  /**
   * Flush all pending debounced writes synchronously (for graceful shutdown).
   */
  static _flushAll() {
    for (const [filePath, timer] of _debounceTimers) {
      clearTimeout(timer);
    }
    _debounceTimers.clear();

    for (const [filePath, data] of _pendingWrites) {
      try {
        atomicWriteSync(filePath, data);
      } catch (e) {
        logger.error(`Failed to flush state to ${filePath}: ${e.message}`);
      }
    }
    _pendingWrites.clear();
  }

  /**
   * Get workspace usage history.
   * @returns {Array<{path: string, lastUsed: string}>}
   */
  static getHistory() {
    try {
      if (!fs.existsSync(HISTORY_FILE)) return [];
      const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
      const history = JSON.parse(raw);
      // Filter out entries whose paths no longer exist on disk
      const valid = history.filter(entry => entry && entry.path && fs.existsSync(entry.path));
      if (valid.length !== history.length) {
        // Persist the cleaned list silently
        try {
          atomicWriteSync(HISTORY_FILE, JSON.stringify(valid, null, 2));
        } catch (e) { /* ignore write error */ }
      }
      return valid;
    } catch (e) {
      logger.error(`Failed to read workspace history: ${e.message}`);
      return [];
    }
  }

  /**
   * Update workspace usage history.
   * @param {string} workspacePath - Absolute path to the workspace
   */
  static updateHistory(workspacePath) {
    let history = WorkspaceStateService.getHistory();

    // Remove existing entry for this path
    history = history.filter(entry => entry.path !== workspacePath);

    // Add to front
    history.unshift({
      path: workspacePath,
      lastUsed: new Date().toISOString()
    });

    // Keep only the latest MAX_HISTORY entries
    if (history.length > MAX_HISTORY) {
      history = history.slice(0, MAX_HISTORY);
    }

    try {
      atomicWriteSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (e) {
      logger.error(`Failed to save workspace history: ${e.message}`);
    }
  }

  /**
   * Remove a workspace from history by path.
   * @param {string} workspacePath - Absolute path to remove
   */
  static removeFromHistory(workspacePath) {
    try {
      let history = WorkspaceStateService.getHistory();
      history = history.filter(entry => entry.path !== workspacePath);
      const dir = path.dirname(HISTORY_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
    } catch (e) {
      logger.error(`Failed to remove workspace from history: ${e.message}`);
    }
  }

  /**
   * Restore the last used workspace on server startup.
   * @returns {string|null} The restored workspace path, or null if none found
   */
  static restoreLastWorkspace() {
    const history = WorkspaceStateService.getHistory();
    if (history.length === 0) return null;

    const lastWorkspace = history[0];
    if (!lastWorkspace || !lastWorkspace.path) return null;

    // Check if the path still exists
    if (!fs.existsSync(lastWorkspace.path)) {
      logger.warn(`Last workspace path does not exist: ${lastWorkspace.path}`);
      return null;
    }

    // Set it as the active workspace
    try {
      const FileService = require('./FileService');
      FileService.setWorkspaceRoot(lastWorkspace.path);
      logger.info(`Restored last workspace: ${lastWorkspace.path}`);
      return lastWorkspace.path;
    } catch (e) {
      logger.warn(`Failed to restore workspace: ${e.message}`);
      return null;
    }
  }

  /**
   * Check whether a given path is inside the WORKFLOWS directory of a workspace.
   * @param {string} workspacePath - Absolute path to the workspace root
   * @param {string} targetPath - Absolute path to check
   * @returns {boolean}
   */
  static isWorkflowsPath(workspacePath, targetPath) {
    const workflowsDir = path.join(workspacePath, WORKFLOWS_DIR);
    const normalizedWorkflow = path.resolve(workflowsDir).replace(/\\/g, '/');
    const normalizedTarget = path.resolve(targetPath).replace(/\\/g, '/');
    return normalizedTarget.startsWith(normalizedWorkflow + '/') || normalizedTarget === normalizedWorkflow;
  }
}

module.exports = WorkspaceStateService;
