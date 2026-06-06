import fs from 'fs';
import path from 'path';

const config = require('../config');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { atomicWriteSync } = require('../utils/atomicWrite');

// Types for browse results
interface DirectoryEntry {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size: number;
  modifiedAt: Date;
}

interface BrowseResult {
  currentPath: string | null;
  parentPath: string | null;
  directories: Array<{ name: string; path: string }>;
}

interface ReadFileResult {
  content: string;
  encoding: string;
  size: number;
  warning?: string;
}

interface ActiveExecution {
  excludedPaths: string[];
}

/**
 * Safe file operations within the workspace
 */
class FileService {
  /** Runtime override for workspace root */
  static runtimeWorkspaceRoot: string | null = null;

  /** 按 runId 追踪的活跃执行 */
  static _activeExecutions: Map<string, ActiveExecution> = new Map();

  /**
   * 是否有工作流正在执行（getter，保持向后兼容）
   * 旧代码中 `FileService.isWorkflowExecution` 是布尔值，现在改为 getter
   */
  static get isWorkflowExecution(): boolean {
    return FileService._activeExecutions.size > 0;
  }

  /**
   * 获取所有活跃执行的排除路径（合并去重）
   * 旧代码中 `FileService.excludedPaths` 是数组，现在改为 getter
   */
  static get excludedPaths(): string[] {
    const paths: string[] = [];
    for (const exec of FileService._activeExecutions.values()) {
      paths.push(...exec.excludedPaths);
    }
    return [...new Set(paths)];
  }

  /**
   * Get the active workspace root.
   * Returns null when no workspace is active (all deactivated).
   */
  static getWorkspaceRoot(): string | null {
    return FileService.runtimeWorkspaceRoot;
  }

  /**
   * Set the workspace root at runtime.
   * Ensures WORKFLOWS folder exists, loads saved state, and updates history.
   * @param newRoot - Absolute or relative path to use as workspace root
   * @returns The resolved path and loaded state
   */
  static setWorkspaceRoot(newRoot: string): { path: string; loadedState: any } {
    const resolved = path.resolve(newRoot);
    if (!fs.existsSync(resolved)) {
      throw new AppError('NOT_FOUND', `Directory does not exist: ${newRoot}`, 404);
    }
    if (!fs.statSync(resolved).isDirectory()) {
      throw new AppError('VALIDATION_ERROR', '路径不是目录', 400);
    }
    FileService.runtimeWorkspaceRoot = resolved;
    logger.info(`Workspace root changed to: ${resolved}`);

    // 同步激活工作区到 WorkspaceManager
    try {
      const WorkspaceManager = require('./WorkspaceManager');
      const existing = WorkspaceManager.findByPath(resolved);
      if (!existing) {
        WorkspaceManager.activate(resolved);
        logger.info(`Workspace activated in WorkspaceManager: ${resolved}`);
      }
    } catch (e) {
      logger.warn('Failed to activate workspace in WorkspaceManager:', e);
    }

    // Backup existing WORKFLOWS folder before any changes (for crash recovery)
    const WorkspaceStateService = require('./WorkspaceStateService');
    WorkspaceStateService.backupWorkflowsFolder(resolved);

    // Ensure WORKFLOWS folder exists (with backup restore if needed)
    WorkspaceStateService.ensureWorkflowsFolder(resolved);

    // Load state and restore to models/services
    const loadedState = WorkspaceStateService.loadState(resolved);

    // 迁移：修正工作区工作流的 workspaceId，使其与 manifest 中的 ID 一致
    if (loadedState?.workflows?.length > 0 && loadedState?.manifest?.workspaceId) {
      const correctWsId = loadedState.manifest.workspaceId;
      let migrated = false;
      loadedState.workflows = loadedState.workflows.map((w: any) => {
        if (w.workspaceId && w.workspaceId !== correctWsId) {
          migrated = true;
          return { ...w, workspaceId: correctWsId };
        }
        return w;
      });
      if (migrated) {
        try {
          const wfPath = path.join(resolved, 'WORKFLOWS', 'workflows.json');
          atomicWriteSync(wfPath, JSON.stringify(loadedState.workflows, null, 2));
          logger.info(`Migrated ${loadedState.workflows.length} workflow(s) workspaceId to: ${correctWsId}`);
        } catch (e: any) {
          logger.warn(`Failed to persist migrated workflows: ${e.message}`);
        }
      }
    }

    if (loadedState) {
      try {
        const WorkflowModel = require('../models/Workflow');
        const AgentModel = require('../models/Agent');
        const ChatSessionModel = require('../models/ChatSession');
        const PromptTemplateModel = require('../models/PromptTemplate');
        const SkillService = require('./SkillService');
        const McpService = require('./McpService');

        // 工作流：始终 clear+reload（即使初始为空，WorkspaceManager.activate 可能刚克隆了全局模板）
        WorkflowModel.clear();
        if (loadedState.workflows && loadedState.workflows.length > 0) {
          WorkflowModel.reload(loadedState.workflows);
        }
        // 智能体始终存安装目录，不从工作区加载（不清除现有智能体）
        // Agent data is always global, never reloaded from workspace
        // Task/TaskQueue: 统一存储在 data/ 目录，不从工作区加载
        if (loadedState.chatSessions && loadedState.chatSessions.length > 0) {
          const globalChats = ChatSessionModel.findAll({ page: 1, limit: 99999 }).items.filter((c: any) => !c.workspaceId);
          ChatSessionModel.clear();
          ChatSessionModel.reload(loadedState.chatSessions);
          if (globalChats.length > 0) ChatSessionModel.reload(globalChats);
        }
        // 提示模板始终全局，不从工作区加载（不清除现有数据）
        if (loadedState.skills && loadedState.skills.installed && loadedState.skills.installed.length > 0) {
          SkillService.reload(loadedState.skills.installed);
        }
        if (loadedState.mcpTools && loadedState.mcpTools.installed && loadedState.mcpTools.installed.length > 0) {
          McpService.reload(loadedState.mcpTools.installed);
        }
      } catch (e: any) {
        logger.warn(`Failed to restore workspace state: ${e.message}`);
      }
    }

    // Reset stuck/stale nodes after workspace switch
    try {
      const WorkflowService = require('./WorkflowService');
      WorkflowService.resetStuckNodes();
    } catch (e) { /* ignore */ }

    // Initialize new services with the new workspace root
    const services = [
      { name: 'ArtifactIndexService', init: (r: string) => { const s = require('./ArtifactIndexService'); if (s.stopWatching) s.stopWatching(); s.init(r); } },
      { name: 'CheckpointService', init: (r: string) => require('./CheckpointService').init(r) },
      { name: 'ReportService', init: (r: string) => require('./ReportService').init(r) },
      { name: 'MemoryService', init: (r: string) => require('./MemoryService').init(r) },
      { name: 'SnapshotService', init: (r: string) => require('./SnapshotService').init(r) },
      { name: 'TagService', init: (r: string) => require('./TagService').init(r) },
      { name: 'KnowledgeService', init: (r: string) => require('./KnowledgeService').init(r) },
    ];
    for (const svc of services) {
      try {
        svc.init(resolved);
      } catch (e: any) {
        logger.warn(`Failed to init ${svc.name}: ${e.message}`);
      }
    }
    logger.info(`Services initialized for workspace: ${resolved}`);

    // Update workspace history
    WorkspaceStateService.updateHistory(resolved);

    // Register in WorkspaceManager so it appears in workflow tabs
    // WorkspaceManager.activate() may clone global templates into an empty workspace —
    // those clones are written to disk but NOT added to the in-memory WorkflowModel Map.
    // We must re-read the final state from disk and reload into WorkflowModel to prevent
    // _doPersist() from overwriting the cloned templates with an incomplete in-memory set.
    try {
      const WorkspaceManager = require('./WorkspaceManager');
      WorkspaceManager.activate(resolved);

      // Re-load state after activate() (which may have cloned global templates to disk)
      const finalState = WorkspaceStateService.loadState(resolved);
      if (finalState?.workflows) {
        try {
          const WorkflowModel = require('../models/Workflow');
          WorkflowModel.clear();
          WorkflowModel.reload(finalState.workflows);
        } catch (e: any) {
          logger.warn(`Failed to reload workflows after workspace activation: ${e.message}`);
        }
      }
    } catch (e) { /* ignore — workspace may already be registered */ }

    return { path: resolved, loadedState };
  }

  /**
   * 设置执行模式 - 按 runId 追踪，支持多个工作流并行执行
   * @param runId - 执行的唯一标识
   * @param excludedPaths - 需要排除的绝对路径
   */
  static setExecutionMode(runId: string, excludedPaths: string[] = []): void {
    FileService._activeExecutions.set(runId, { excludedPaths: excludedPaths || [] });
    logger.info('Workflow execution mode enabled', { runId, excludedPaths });
  }

  /**
   * 清除指定执行的隔离模式
   * @param runId - 执行的唯一标识
   */
  static clearExecutionMode(runId: string): void {
    FileService._activeExecutions.delete(runId);
    logger.info('Workflow execution mode cleared', { runId });
  }

  /**
   * Resolve a path — supports both absolute paths (anywhere on disk)
   * and relative paths (resolved against workspace root).
   * During workflow execution mode, rejects access to WORKFLOWS directory.
   */
  static resolvePath(inputPath?: string | null): string | null {
    const workspaceRoot = FileService.getWorkspaceRoot();
    if (!inputPath) {
      return workspaceRoot;
    }

    // Normalize backslashes to forward slashes for consistent handling
    const normalized = inputPath.replace(/\\/g, '/');

    // Absolute path — use directly, just validate it exists
    // Check both the normalized form (D:/foo) and original form
    if (path.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
      const resolved = path.resolve(inputPath);

      // Check execution mode isolation — block excluded paths (e.g. WORKFLOWS data dir)
      if (FileService.isWorkflowExecution) {
        for (const excluded of FileService.excludedPaths) {
          const normalizedExcluded = path.resolve(excluded).replace(/\\/g, '/');
          const normalizedResolved = resolved.replace(/\\/g, '/');
          if (normalizedResolved === normalizedExcluded || normalizedResolved.startsWith(normalizedExcluded + '/')) {
            throw new AppError('FORBIDDEN', '工作流执行期间禁止访问此路径', 403);
          }
        }
      }

      // In normal (non-execution) mode, enforce workspace boundary for absolute paths
      if (!FileService.isWorkflowExecution && workspaceRoot) {
        const normalizedRoot = path.resolve(workspaceRoot).replace(/\\/g, '/');
        const normalizedResolved = resolved.replace(/\\/g, '/');
        if (normalizedResolved !== normalizedRoot && !normalizedResolved.startsWith(normalizedRoot + '/')) {
          throw new AppError('FORBIDDEN', '路径在活跃工作区之外', 403);
        }
      }

      return resolved;
    }

    // Reject ".." components
    if (normalized.includes('..')) {
      throw new AppError('VALIDATION_ERROR', 'Path must not contain ".."', 400);
    }

    // Relative path — resolve against workspace root
    if (!workspaceRoot) {
      throw new AppError('VALIDATION_ERROR', '没有活跃工作区，无法使用相对路径', 400);
    }
    const resolved = path.resolve(workspaceRoot, inputPath);

    // Check execution mode isolation — block excluded paths (e.g. WORKFLOWS data dir)
    if (FileService.isWorkflowExecution) {
      for (const excluded of FileService.excludedPaths) {
        const normalizedExcluded = path.resolve(excluded).replace(/\\/g, '/');
        const normalizedResolved = resolved.replace(/\\/g, '/');
        if (normalizedResolved === normalizedExcluded || normalizedResolved.startsWith(normalizedExcluded + '/')) {
          throw new AppError('FORBIDDEN', '工作流执行期间禁止访问此路径', 403);
        }
      }
    }

    return resolved;
  }

  /**
   * Resolve a path for browsing purposes - allows absolute paths outside workspace
   * @param inputPath - Path to resolve (absolute or relative)
   * @returns Resolved absolute path
   */
  static resolveBrowsingPath(inputPath?: string | null): string | null {
    const root = FileService.getWorkspaceRoot();
    if (!inputPath) {
      return root ? path.resolve(root) : null;
    }

    // Normalize backslashes for consistent absolute path detection
    const normalized = inputPath.replace(/\\/g, '/');

    // If absolute, validate it exists and is a directory, then use it directly
    if (path.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
      const resolved = path.resolve(inputPath);
      if (!fs.existsSync(resolved)) {
        throw new AppError('NOT_FOUND', `Directory '${inputPath}' not found`, 404);
      }
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        throw new AppError('VALIDATION_ERROR', '路径不是目录', 400);
      }
      return resolved;
    }

    // Relative paths go through normal workspace-restricted resolution
    return FileService.resolvePath(inputPath);
  }

  /**
   * Get relative path from workspace root
   */
  static getRelativePath(absolutePath: string): string {
    const root = FileService.getWorkspaceRoot();
    if (!root) return absolutePath;
    const normalizedRoot = path.resolve(root);
    return path.relative(normalizedRoot, absolutePath).replace(/\\/g, '/');
  }

  /**
   * List directory contents
   */
  static listDirectory(relativePath?: string | null): DirectoryEntry[] {
    const workspaceRoot = FileService.getWorkspaceRoot();
    if (!workspaceRoot) {
      return []; // No active workspace
    }

    const fullPath = FileService.resolvePath(relativePath);

    if (!fullPath || !fs.existsSync(fullPath)) {
      throw new AppError('NOT_FOUND', `Directory '${relativePath || '/'}' not found`, 404);
    }

    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) {
      throw new AppError('VALIDATION_ERROR', '路径不是目录', 400);
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    return entries.map(entry => {
      const entryPath = path.join(fullPath!, entry.name);
      const entryStat = fs.statSync(entryPath);
      return {
        name: entry.name,
        path: FileService.getRelativePath(entryPath),
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entry.isDirectory() ? 0 : entryStat.size,
        modifiedAt: entryStat.mtime
      };
    });
  }

  /**
   * Read file content
   */
  static readFile(relativePath: string): ReadFileResult {
    const fullPath = FileService.resolvePath(relativePath);

    if (!fullPath || !fs.existsSync(fullPath)) {
      throw new AppError('NOT_FOUND', `File '${relativePath}' not found`, 404);
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      throw new AppError('VALIDATION_ERROR', 'Path is a directory, not a file', 400);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const result: ReadFileResult = {
      content,
      encoding: 'utf-8',
      size: stat.size
    };

    // Warn if file is larger than 5MB
    const FIVE_MB = 5 * 1024 * 1024;
    if (stat.size > FIVE_MB) {
      result.warning = `File is ${(stat.size / (1024 * 1024)).toFixed(2)}MB, which exceeds the recommended 5MB limit. Performance may be affected.`;
    }

    return result;
  }

  /**
   * Write/create file
   */
  static writeFile(relativePath: string, content: string): { path: string; size: number } {
    const fullPath = FileService.resolvePath(relativePath);

    if (!fullPath) {
      throw new AppError('VALIDATION_ERROR', '没有活跃工作区', 400);
    }

    // Ensure parent directory exists
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, 'utf-8');
    const stat = fs.statSync(fullPath);

    logger.info(`File written: ${relativePath}`);
    return {
      path: relativePath,
      size: stat.size
    };
  }

  /**
   * Create directory. Allows creating outside workspace for new workspace folders.
   */
  static createDirectory(relativePath: string): { path: string } {
    // Allow absolute paths outside workspace (needed for creating new workspaces)
    const normalized = relativePath.replace(/\\/g, '/');
    let fullPath: string;
    if (path.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
      fullPath = path.resolve(relativePath);
    } else {
      const resolved = FileService.resolvePath(relativePath);
      if (!resolved) {
        throw new AppError('VALIDATION_ERROR', '没有活跃工作区', 400);
      }
      fullPath = resolved;
    }

    if (fs.existsSync(fullPath)) {
      throw new AppError('CONFLICT', `Directory '${relativePath}' already exists`, 409);
    }

    fs.mkdirSync(fullPath, { recursive: true });
    logger.info(`Directory created: ${relativePath}`);
    return { path: relativePath };
  }

  /**
   * Delete file or directory
   */
  static deletePath(relativePath: string): { path: string } {
    const fullPath = FileService.resolvePath(relativePath);

    if (!fullPath || !fs.existsSync(fullPath)) {
      throw new AppError('NOT_FOUND', `Path '${relativePath}' not found`, 404);
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }

    logger.info(`Deleted: ${relativePath}`);
    return { path: relativePath };
  }

  /**
   * Rename/move file or directory
   */
  static renamePath(oldPath: string, newPath: string): { oldPath: string; newPath: string } {
    const fullOldPath = FileService.resolvePath(oldPath);
    const fullNewPath = FileService.resolvePath(newPath);

    if (!fullOldPath || !fs.existsSync(fullOldPath)) {
      throw new AppError('NOT_FOUND', `Path '${oldPath}' not found`, 404);
    }

    if (fullNewPath && fs.existsSync(fullNewPath)) {
      throw new AppError('CONFLICT', `Destination '${newPath}' already exists`, 409);
    }

    if (!fullNewPath) {
      throw new AppError('VALIDATION_ERROR', '没有活跃工作区', 400);
    }

    // Ensure parent directory of destination exists
    const dir = path.dirname(fullNewPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.renameSync(fullOldPath, fullNewPath);
    logger.info(`Renamed: ${oldPath} -> ${newPath}`);
    return { oldPath, newPath };
  }

  /**
   * Create workspace
   */
  static createWorkspace(
    name: string,
    template?: string,
    parentPath?: string
  ): { path: string; name: string } {
    if (!name || typeof name !== 'string') {
      throw new AppError('VALIDATION_ERROR', '工作区名称不能为空', 400);
    }

    // Sanitize name — only block characters that are invalid in file names
    const sanitizedName = name.replace(/[\/\\:*?"<>|]/g, '_').replace(/^\.+|\.+$/g, '').trim() || 'workspace';

    // Determine parent directory - support absolute paths outside workspace
    let parentDir: string;
    const normalizedParent = parentPath ? parentPath.replace(/\\/g, '/') : '';
    if (parentPath && (path.isAbsolute(normalizedParent) || /^[A-Za-z]:/.test(normalizedParent))) {
      const resolved = path.resolve(parentPath);
      if (!fs.existsSync(resolved)) {
        throw new AppError('NOT_FOUND', `Parent directory '${parentPath}' not found`, 404);
      }
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        throw new AppError('VALIDATION_ERROR', '父路径不是目录', 400);
      }
      parentDir = resolved;
    } else if (parentPath) {
      const resolved = FileService.resolvePath(parentPath);
      if (!resolved) {
        throw new AppError('VALIDATION_ERROR', '没有活跃工作区且未指定父路径', 400);
      }
      parentDir = resolved;
    } else {
      const root = FileService.getWorkspaceRoot();
      if (!root) {
        throw new AppError('VALIDATION_ERROR', '没有活跃工作区且未指定父路径', 400);
      }
      parentDir = root;
    }

    const workspacePath = path.join(parentDir, sanitizedName);

    if (fs.existsSync(workspacePath)) {
      throw new AppError('CONFLICT', `Workspace '${sanitizedName}' already exists`, 409);
    }

    fs.mkdirSync(workspacePath, { recursive: true });

    const WorkspaceStateService = require('./WorkspaceStateService');

    // Ensure WORKFLOWS folder exists in the new workspace
    try {
      WorkspaceStateService.ensureWorkflowsFolder(workspacePath);
    } catch (e: any) {
      logger.warn(`Failed to initialize WORKFLOWS folder in new workspace: ${e.message}`);
    }

    // Create basic template if requested
    if (template === 'basic') {
      fs.mkdirSync(path.join(workspacePath, 'src'), { recursive: true });
      fs.writeFileSync(path.join(workspacePath, 'README.md'), `# ${name}\n\nCreated by Multi-Agent Platform\n`);
    }

    // For workspaces outside the workspace root, return absolute path
    const root = FileService.getWorkspaceRoot();
    const normalizedRoot = root ? path.resolve(root) : null;
    const resolvedWorkspace = path.resolve(workspacePath);
    const returnPath = (normalizedRoot && resolvedWorkspace.startsWith(normalizedRoot))
      ? FileService.getRelativePath(workspacePath)
      : resolvedWorkspace;

    // Register in WorkspaceManager so it appears in workflow tabs
    try {
      const WorkspaceManager = require('./WorkspaceManager');
      WorkspaceManager.activate(resolvedWorkspace);
    } catch (e: any) {
      logger.warn(`Failed to register workspace in WorkspaceManager: ${e.message}`);
    }

    // Update workspace history so it appears in navbar dropdown
    WorkspaceStateService.updateHistory(resolvedWorkspace);

    logger.info(`Workspace created: ${returnPath}`);
    return {
      path: returnPath,
      name: sanitizedName
    };
  }

  /**
   * Browse directories only (for directory picker).
   * Supports absolute paths (system-wide) and relative paths (workspace-relative).
   * Empty path shows system drives on Windows or / on Unix.
   */
  static browseDirectories(inputPath: string): BrowseResult {
    // Special marker: "/" or "/drives" → show system drives
    if (inputPath === '/' || inputPath === '/drives') {
      return FileService._browseRoot();
    }

    const workspaceRoot = FileService.getWorkspaceRoot();

    // Normalize backslashes for consistent absolute path detection
    const normalizedInput = inputPath ? inputPath.replace(/\\/g, '/') : '';
    const isAbsolute = normalizedInput && (path.isAbsolute(normalizedInput) || /^[A-Za-z]:/.test(normalizedInput));

    // No active workspace and no absolute path — show system drives
    if (!workspaceRoot && !isAbsolute && inputPath) {
      return FileService._browseRoot();
    }

    // Empty path → browse workspace root or show system drives
    if (!inputPath) {
      if (!workspaceRoot) {
        return FileService._browseRoot();
      }
      const fullPath = path.resolve(workspaceRoot);
      const normalizedRoot = path.resolve(workspaceRoot);
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      const directories = entries
        .filter(e => e.isDirectory())
        .map(e => ({
          name: e.name,
          path: path.relative(normalizedRoot, path.join(fullPath, e.name)).replace(/\\/g, '/')
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return { currentPath: '', parentPath: null, directories };
    }

    // Reject ".." for relative paths
    if (!isAbsolute && normalizedInput.includes('..')) {
      throw new AppError('VALIDATION_ERROR', 'Path must not contain ".."', 400);
    }

    // Resolve to absolute path
    let fullPath: string;
    if (isAbsolute) {
      fullPath = path.resolve(inputPath);
    } else {
      if (!workspaceRoot) {
        throw new AppError('VALIDATION_ERROR', '没有活跃工作区，无法使用相对路径', 400);
      }
      fullPath = path.resolve(workspaceRoot, inputPath);
    }

    if (!fs.existsSync(fullPath)) {
      throw new AppError('NOT_FOUND', `Directory '${inputPath}' not found`, 404);
    }

    const stat = fs.statSync(fullPath);
    if (!stat.isDirectory()) {
      throw new AppError('VALIDATION_ERROR', '路径不是目录', 400);
    }

    const normalizedRoot = workspaceRoot ? path.resolve(workspaceRoot) : null;
    const useRelative = !isAbsolute && normalizedRoot && fullPath.startsWith(normalizedRoot);

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const directories = entries
      .filter(entry => entry.isDirectory())
      .map(entry => {
        const entryPath = path.join(fullPath, entry.name);
        return {
          name: entry.name,
          path: useRelative ? path.relative(normalizedRoot!, entryPath).replace(/\\/g, '/') : entryPath
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    // Compute current and parent paths
    let currentPath: string | null;
    let parentPath: string | null;

    if (useRelative) {
      // Workspace-relative paths
      currentPath = fullPath === normalizedRoot
        ? ''
        : path.relative(normalizedRoot!, fullPath).replace(/\\/g, '/');
      const parentAbs = path.dirname(fullPath);
      parentPath = parentAbs === normalizedRoot
        ? ''
        : path.relative(normalizedRoot!, parentAbs).replace(/\\/g, '/');
    } else {
      // Absolute paths
      currentPath = fullPath;
      parentPath = path.dirname(fullPath) !== fullPath ? path.dirname(fullPath) : null;
    }

    return {
      currentPath,
      parentPath,
      directories
    };
  }

  /**
   * Browse root — list available drives on Windows, or / on Unix
   */
  static _browseRoot(): BrowseResult {
    const isWin = process.platform === 'win32';

    if (isWin) {
      // List available drive letters by checking common ones
      const drives: Array<{ name: string; path: string }> = [];
      for (let i = 65; i <= 90; i++) {
        const letter = String.fromCharCode(i);
        const drivePath = `${letter}:\\`;
        try {
          if (fs.existsSync(drivePath)) {
            fs.accessSync(drivePath, fs.constants.R_OK);
            drives.push({ name: `${letter}:`, path: drivePath });
          }
        } catch (e) {
          // Drive not accessible, skip
        }
      }
      return {
        currentPath: '',
        parentPath: null,
        directories: drives
      };
    }

    // Unix: list root directories
    const entries = fs.readdirSync('/', { withFileTypes: true });
    const directories = entries
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, path: `/${e.name}` }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      currentPath: '/',
      parentPath: null,
      directories
    };
  }

  /**
   * Check if a path is within the workspace boundary.
   * @param targetPath - Absolute path to check
   * @returns true if the path is inside the workspace
   */
  static isWithinWorkspace(targetPath: string): boolean {
    const root = FileService.getWorkspaceRoot();
    if (!root) return false;
    const workspaceRoot = path.resolve(root);
    const resolved = path.resolve(targetPath);
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
    const normalizedTarget = resolved.replace(/\\/g, '/');
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + '/');
  }

  /**
   * Ensure workspace root exists
   */
  static ensureWorkspace(): void {
    const root = FileService.getWorkspaceRoot();
    if (!root) return; // No active workspace
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
      logger.info(`Workspace root created: ${root}`);
    }
  }
}

// 使用 CommonJS 导出以保持与现有路由的兼容性
module.exports = FileService;
module.exports.FileService = FileService;
module.exports.default = FileService;
