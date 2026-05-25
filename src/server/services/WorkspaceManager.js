const fs = require('fs');
const path = require('path');
const { generateId } = require('../utils/id');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { atomicWriteSync } = require('../utils/atomicWrite');

/**
 * 工作区管理器 - 管理多个活跃工作区，支持并行工作流执行
 * 每个工作区拥有独立的 workflowData 和 agentData 缓存
 */
class WorkspaceManager {
  /** @type {Map<string, { id: string, path: string, name: string, activatedAt: Date, workflowData: Array, agentData: Array }>} */
  static _workspaces = new Map();

  /**
   * 激活一个工作区
   * - 确保 WORKFLOWS 文件夹存在
   * - 加载已保存的状态（workflows、agents）
   * - 注册到管理器中
   * @param {string} workspacePath - 工作区的绝对路径
   * @returns {{ id: string, path: string, name: string, loadedState: Object|null }}
   */
  static activate(workspacePath) {
    const resolved = path.resolve(workspacePath);

    // 校验路径是否存在且为目录
    if (!fs.existsSync(resolved)) {
      throw new AppError('NOT_FOUND', `Directory does not exist: ${workspacePath}`, 404);
    }
    if (!fs.statSync(resolved).isDirectory()) {
      throw new AppError('VALIDATION_ERROR', `Path is not a directory: ${workspacePath}`, 400);
    }

    // 检查是否已激活（按路径去重）
    const existing = WorkspaceManager.findByPath(resolved);
    if (existing) {
      logger.info(`Workspace already active: ${resolved}, id=${existing.id}`);
      return {
        id: existing.id,
        path: existing.path,
        name: existing.name,
        loadedState: null
      };
    }

    // 确保 WORKFLOWS 文件夹存在
    const WorkspaceStateService = require('./WorkspaceStateService');
    WorkspaceStateService.ensureWorkflowsFolder(resolved);

    // 加载已保存的状态
    const loadedState = WorkspaceStateService.loadState(resolved);

    // 复用已保存的工作区 ID，避免重启后 ID 变化导致工作流过滤失效
    let workspaceId = loadedState?.manifest?.workspaceId || null;
    const isNewId = !workspaceId;
    if (isNewId) {
      workspaceId = generateId();
      // 同步写入 manifest.json，确保重启后 ID 一致
      try {
        const manifestPath = path.join(resolved, 'WORKFLOWS', 'manifest.json');
        const manifest = {
          workspacePath: resolved,
          workspaceId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        if (!fs.existsSync(path.dirname(manifestPath))) {
          fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
        }
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
      } catch (e) {
        logger.warn(`Failed to persist workspace manifest: ${e.message}`);
      }
    }

    // 迁移：将已有工作流的旧 workspaceId 更新为当前 ID
    // 注意：全局工作流（workspaceId 为空）不应被迁移，保持全局状态
    if (loadedState?.workflows?.length > 0) {
      let migrated = false;
      const migratedWfs = loadedState.workflows.map(w => {
        if (w.workspaceId && w.workspaceId !== workspaceId) {
          migrated = true;
          return { ...w, workspaceId };
        }
        return w;
      });
      if (migrated) {
        try {
          const wfPath = path.join(resolved, 'WORKFLOWS', 'workflows.json');
          atomicWriteSync(wfPath, JSON.stringify(migratedWfs, null, 2));
          loadedState.workflows = migratedWfs;
          logger.info(`Migrated ${migratedWfs.length} workflow(s) to workspace ID: ${workspaceId}`);
        } catch (e) {
          logger.warn(`Failed to migrate workflows: ${e.message}`);
        }
      }
    }

    const workspaceName = path.basename(resolved);

    // 构建工作区对象
    const workspace = {
      id: workspaceId,
      path: resolved,
      name: workspaceName,
      activatedAt: new Date(),
      workflowData: loadedState?.workflows || [],
      agentData: loadedState?.agents || []
    };

    WorkspaceManager._workspaces.set(workspaceId, workspace);
    logger.info(`Workspace activated: ${resolved}, id=${workspaceId}`);
    WorkspaceManager._persist();

    // 更新工作区历史记录，使切换器下拉菜单显示所有使用过的工作区
    try {
      WorkspaceStateService.updateHistory(resolved);
    } catch (e) { /* ignore */ }

    return {
      id: workspaceId,
      path: resolved,
      name: workspaceName,
      loadedState
    };
  }

  /**
   * 停用一个工作区（从管理器中移除）
   * @param {string} workspaceId - 工作区 ID
   */
  static deactivate(workspaceId) {
    const workspace = WorkspaceManager._workspaces.get(workspaceId);
    if (!workspace) {
      throw new AppError('NOT_FOUND', `Workspace not found: ${workspaceId}`, 404);
    }

    // 停用 = 从活跃列表移除，数据保留在工作区文件夹中
    // 不删除磁盘文件，不触发 Model.delete()

    // 1. 刷新待写入数据到磁盘
    try {
      require('../models/Workflow')._flush();
      require('../models/Agent')._flush();
      require('../models/Task')._flush();
    } catch (e) { /* ignore */ }

    // 2. 停止运行中的工作流
    try {
      const WorkflowModel = require('../models/Workflow');
      const WorkflowService = require('./WorkflowService');
      for (const wf of WorkflowModel.findAll({ page: 1, limit: 100000 }).items) {
        if (wf.workspaceId === workspaceId && (wf.executionStatus === 'running' || wf.executionStatus === 'paused')) {
          try { WorkflowService.stop(wf.id); } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { /* ignore */ }

    // 3. 从内存 Map 中释放（不写磁盘，数据已在工作区文件夹中）
    try {
      require('../models/Workflow')._removeFromMap(workspaceId);
      require('../models/Agent')._removeFromMap(workspaceId);
      require('../models/Task')._removeFromMap(workspaceId);
      logger.info(`Released in-memory entries for workspace: ${workspaceId}`);
    } catch (e) { /* ignore */ }

    // 4. 清除 MemoryService 缓存（磁盘文件保留）
    try {
      const MemoryService = require('./MemoryService');
      // 清除该工作区工作流的记忆缓存
      const WorkflowModel = require('../models/Workflow');
      for (const wf of WorkflowModel.findAll({ page: 1, limit: 100000 }).items) {
        if (wf.workspaceId === workspaceId) {
          MemoryService._cache.delete(wf.id);
        }
      }
    } catch (e) { /* ignore */ }

    // 5. 从活跃工作区列表和历史记录中移除（数据保留在磁盘，但切换器中不再显示）
    WorkspaceManager._workspaces.delete(workspaceId);

    // 6. 如果停用的是当前活跃工作区，切换到其他工作区；如果无剩余，清除状态
    try {
      const FileService = require('./FileService');
      if (FileService.runtimeWorkspaceRoot === workspace.path) {
        // 查找其他活跃工作区作为后备
        const remaining = Array.from(WorkspaceManager._workspaces.values());
        if (remaining.length > 0) {
          FileService.runtimeWorkspaceRoot = remaining[remaining.length - 1].path;
          logger.info(`Switched active workspace to: ${FileService.runtimeWorkspaceRoot}`);
        } else {
          FileService.runtimeWorkspaceRoot = null;
          logger.info('No active workspace remaining');
        }
      }
      // 只要还有剩余工作区，更新 current-workspace.json；否则删除
      try {
        const currentFile = path.join(config.data.dir, 'current-workspace.json');
        const remaining = Array.from(WorkspaceManager._workspaces.values());
        if (remaining.length > 0) {
          const activePath = FileService.runtimeWorkspaceRoot || remaining[remaining.length - 1].path;
          fs.writeFileSync(currentFile, JSON.stringify({ path: activePath }, null, 2), 'utf-8');
        } else {
          if (fs.existsSync(currentFile)) fs.unlinkSync(currentFile);
        }
      } catch (_) {}
    } catch (e) { /* ignore */ }

    try {
      const WorkspaceStateService = require('./WorkspaceStateService');
      WorkspaceStateService.removeFromHistory(workspace.path);
    } catch (e) { /* ignore */ }
    logger.info(`Workspace deactivated: ${workspace.path}, id=${workspaceId}`);
    WorkspaceManager._persist();
  }

  /**
   * 获取所有活跃工作区的摘要信息
   * @returns {Array<{ id: string, path: string, name: string, activatedAt: Date, workflowCount: number, agentCount: number }>}
   */
  static getActive() {
    let WorkflowModel;
    try { WorkflowModel = require('../models/Workflow'); } catch (e) { /* ignore */ }

    // 当前活跃工作区路径
    let activePath = null;
    try {
      const FileService = require('./FileService');
      activePath = FileService.runtimeWorkspaceRoot || null;
    } catch (e) { /* ignore */ }

    const result = [];
    for (const ws of WorkspaceManager._workspaces.values()) {
      let wsCount = 0;
      const isActive = activePath && ws.path === activePath;

      if (isActive && WorkflowModel) {
        // 当前活跃工作区：从内存中读取（所有工作流都有 workspaceId，包含全局模板+工作区专属）
        wsCount = WorkflowModel.findAll({ page: 1, limit: 99999 }).items.length;
      } else {
        // 非活跃工作区：从磁盘 WORKFLOWS/workflows.json 读取
        try {
          const wfPath = path.join(ws.path, 'WORKFLOWS', 'workflows.json');
          if (fs.existsSync(wfPath)) {
            const data = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
            wsCount = Array.isArray(data) ? data.length : 0;
          }
        } catch (e) { /* ignore */ }
      }

      result.push({
        id: ws.id,
        path: ws.path,
        name: ws.name,
        activatedAt: ws.activatedAt,
        workflowCount: wsCount,
        runningWorkflowCount: 0
      });
    }
    return result;
  }

  /**
   * 根据路径查找已激活的工作区
   * @param {string} workspacePath - 工作区路径
   * @returns {Object|null} 工作区对象或 null
   */
  static findByPath(workspacePath) {
    const resolved = path.resolve(workspacePath);
    for (const ws of WorkspaceManager._workspaces.values()) {
      if (ws.path === resolved) {
        return ws;
      }
    }
    return null;
  }

  /**
   * 根据 ID 获取工作区
   * @param {string} workspaceId - 工作区 ID
   * @returns {Object|null} 工作区对象或 null
   */
  static getById(workspaceId) {
    return WorkspaceManager._workspaces.get(workspaceId) || null;
  }

  /**
   * 获取工作区的数据缓存（用于执行时持久化）
   * @param {string} workspaceId - 工作区 ID
   * @returns {{ workflows: Array, agents: Array }}
   */
  static getWorkspaceData(workspaceId) {
    const ws = WorkspaceManager._workspaces.get(workspaceId);
    if (!ws) {
      throw new AppError('NOT_FOUND', `Workspace not found: ${workspaceId}`, 404);
    }
    return {
      workflows: ws.workflowData || [],
      agents: ws.agentData || []
    };
  }

  /**
   * 更新工作区的数据缓存并持久化到文件
   * @param {string} workspaceId - 工作区 ID
   * @param {string} type - 数据类型: 'workflows' 或 'agents'
   * @param {Array} data - 要保存的数据数组
   */
  static updateData(workspaceId, type, data) {
    const ws = WorkspaceManager._workspaces.get(workspaceId);
    if (!ws) {
      throw new AppError('NOT_FOUND', `Workspace not found: ${workspaceId}`, 404);
    }

    if (type === 'workflows') {
      ws.workflowData = data;
    } else if (type === 'agents') {
      ws.agentData = data;
    } else {
      throw new AppError('VALIDATION_ERROR', `Unknown data type: ${type}`, 400);
    }

    // 持久化到文件
    try {
      const WorkspaceStateService = require('./WorkspaceStateService');
      WorkspaceStateService.saveState(ws.path, type, data);
    } catch (e) {
      logger.error(`Failed to persist workspace data for ${ws.path}: ${e.message}`);
    }
  }

  /**
   * Persist the list of active workspace paths to disk
   */
  static _persist() {
    const config = require('../config');
    const filePath = path.join(config.data.dir, 'active-workspaces.json');
    try {
      const paths = [];
      for (const ws of WorkspaceManager._workspaces.values()) {
        paths.push(ws.path);
      }
      fs.writeFileSync(filePath, JSON.stringify(paths, null, 2), 'utf-8');

      // 保存当前活跃工作区路径（用于重启后恢复）
      // Only save when runtimeWorkspaceRoot is set, to avoid overwriting
      // the file with null during startup (restoreAll calls activate before
      // runtimeWorkspaceRoot is set from current-workspace.json)
      const FileService = require('./FileService');
      const currentPath = FileService.runtimeWorkspaceRoot || null;
      if (currentPath) {
        const currentFile = path.join(config.data.dir, 'current-workspace.json');
        fs.writeFileSync(currentFile, JSON.stringify({ path: currentPath }, null, 2), 'utf-8');
      }
    } catch (e) {
      logger.error(`Failed to persist workspace list: ${e.message}`);
    }
  }

  /**
   * Restore all previously active workspaces from persisted file
   */
  static restoreAll() {
    const config = require('../config');
    const filePath = path.join(config.data.dir, 'active-workspaces.json');
    try {
      if (!fs.existsSync(filePath)) return;
      const paths = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // 只注册可用工作区，不自动激活
      for (const wsPath of paths) {
        try {
          if (fs.existsSync(wsPath)) {
            const WorkspaceStateService = require('./WorkspaceStateService');
            WorkspaceStateService.ensureWorkflowsFolder(wsPath);
            const loadedState = WorkspaceStateService.loadState(wsPath);
            let workspaceId = loadedState?.manifest?.workspaceId || null;
            if (!workspaceId) {
              workspaceId = require('../utils/id').generateId();
            }
            const workspaceName = path.basename(wsPath);
            WorkspaceManager._workspaces.set(workspaceId, {
              id: workspaceId,
              path: wsPath,
              name: workspaceName,
              activatedAt: new Date(),
              workflowData: loadedState?.workflows || [],
              agentData: loadedState?.agents || []
            });
          }
        } catch (e) {
          logger.warn(`Failed to register workspace ${wsPath}: ${e.message}`);
        }
      }

      // 只恢复 current-workspace.json 中明确指定的工作区
      const currentFile = path.join(config.data.dir, 'current-workspace.json');
      if (fs.existsSync(currentFile)) {
        try {
          const { path: currentPath } = JSON.parse(fs.readFileSync(currentFile, 'utf-8'));
          if (currentPath && fs.existsSync(currentPath)) {
            const FileService = require('./FileService');
            FileService.runtimeWorkspaceRoot = currentPath;
            logger.info(`Restored active workspace: ${currentPath}`);
          }
        } catch (e) {
          logger.warn(`Failed to restore current workspace: ${e.message}`);
        }
      }
    } catch (e) {
      logger.warn(`Failed to restore workspaces: ${e.message}`);
    }
  }

  /**
   * 获取指定工作区的工作流列表（从磁盘读取，不切换当前工作区）
   * @param {string} workspaceId - 工作区 ID
   * @returns {Array} 工作流列表
   */
  static getWorkflowsForWorkspace(workspaceId) {
    const ws = WorkspaceManager._workspaces.get(workspaceId);
    if (!ws) return [];

    // 如果是当前活跃工作区，直接从内存读取
    try {
      const FileService = require('./FileService');
      if (FileService.runtimeWorkspaceRoot && ws.path === FileService.runtimeWorkspaceRoot) {
        const WorkflowModel = require('../models/Workflow');
        return WorkflowModel.findAll({ page: 1, limit: 99999 }).items;
      }
    } catch (e) { /* fall through to disk read */ }

    // 非当前工作区：从磁盘读取 WORKFLOWS/workflows.json
    try {
      const wfPath = path.join(ws.path, 'WORKFLOWS', 'workflows.json');
      if (fs.existsSync(wfPath)) {
        const data = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
        return Array.isArray(data) ? data : [];
      }
    } catch (e) { /* ignore */ }
    return [];
  }
}

module.exports = WorkspaceManager;
