/**
 * WorkspaceStateService - 工作区状态服务
 * 管理工作区状态持久化
 */

const logger = require('../utils/logger');

export interface WorkspaceState {
  workspaceId: string;
  path?: string;
  name?: string;
  workspacePath?: string;
  workflows?: any[];
  agents?: any[];
  tasks?: any[];
  chatSessions?: any[];
  taskQueues?: any[];
  promptTemplates?: any[];
  skills?: any;
  mcpTools?: any;
  knowledge?: any[];
  tags?: any[];
  artifactIndex?: any[];
  executionLog?: any[];
  manifest?: any;
  createdAt?: Date;
  updatedAt?: Date;
}

export class WorkspaceStateService {
  private static states: Map<string, WorkspaceState> = new Map();
  private static saveTimers: Map<string, any> = new Map();

  private static fileMap: Record<string, string> = {
    manifest: 'manifest.json',
    workflows: 'workflows.json',
    agents: 'agents.json',
    tasks: 'tasks.json',
    skills: 'skills.json',
    'mcp-tools': 'mcp-tools.json',
    mcpTools: 'mcp-tools.json',
    knowledge: 'knowledge.json',
    tags: 'tags.json',
    'artifact-index': 'artifact-index.json',
    artifactIndex: 'artifact-index.json',
    'execution-log': 'execution-log.json',
    executionLog: 'execution-log.json',
    'chat-sessions': 'chat-sessions.json',
    chatSessions: 'chat-sessions.json',
    'task-queues': 'task-queues.json',
    taskQueues: 'task-queues.json',
    'prompt-templates': 'prompt-templates.json',
    promptTemplates: 'prompt-templates.json'
  };

  /**
   * 确保工作流文件夹存在，并创建所有必要的目录和文件
   * 按照架构文档要求创建完整的目录结构
   */
  static ensureWorkflowsFolder(workspacePath: string): void {
    const fs = require('fs');
    const path = require('path');

    try {
      // 创建主目录结构
      const dirs = [
        'WORKFLOWS',
        'WORKFLOWS/.checkpoint',
        'WORKFLOWS/snapshots',
        'reports',
        '.context',
        '.context/shared',
        '.BACKUP'
      ];

      for (const dir of dirs) {
        const fullPath = path.join(workspacePath, dir);
        if (!fs.existsSync(fullPath)) {
          fs.mkdirSync(fullPath, { recursive: true });
        }
      }

      // 创建必要的JSON文件（如果不存在）
      const jsonFiles: Record<string, any> = {
        'WORKFLOWS/manifest.json': {
          workspaceId: path.basename(workspacePath),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        'WORKFLOWS/workflows.json': [],
        'WORKFLOWS/agents.json': [],
        'WORKFLOWS/tasks.json': [],
        'WORKFLOWS/knowledge.json': [],
        'WORKFLOWS/tags.json': [],
        'WORKFLOWS/artifact-index.json': [],
        'WORKFLOWS/chat-sessions.json': [],
        'WORKFLOWS/task-queues.json': [],
        'WORKFLOWS/prompt-templates.json': [],
        'WORKFLOWS/skills.json': [],
        'WORKFLOWS/mcp-tools.json': [],
        'WORKFLOWS/execution-log.json': []
      };

      for (const [filePath, defaultData] of Object.entries(jsonFiles)) {
        const fullPath = path.join(workspacePath, filePath);
        if (!fs.existsSync(fullPath)) {
          fs.writeFileSync(fullPath, JSON.stringify(defaultData, null, 2), 'utf-8');
        }
      }

      // 创建共享池文件
      const poolPath = path.join(workspacePath, '.context', 'shared', 'pool.json');
      if (!fs.existsSync(poolPath)) {
        fs.writeFileSync(poolPath, JSON.stringify({ variables: {}, notes: [] }, null, 2), 'utf-8');
      }

      logger.info(`工作区目录结构已初始化: ${workspacePath}`);
    } catch (e: any) {
      logger.error(`初始化工作区目录失败: ${e.message}`);
    }
  }

  /**
   * 加载状态
   */
  static loadState(workspacePath: string): WorkspaceState | null {
    const fs = require('fs');
    const path = require('path');

    try {
      const workflowsDir = path.join(workspacePath, 'WORKFLOWS');

      const readJson = (filename: string, fallback: any) => {
        const filePath = path.join(workflowsDir, filename);
        if (!fs.existsSync(filePath)) return fallback;
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (Array.isArray(fallback)) return Array.isArray(data) ? data : fallback;
          if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
            return data && typeof data === 'object' && !Array.isArray(data) ? data : fallback;
          }
          return data ?? fallback;
        } catch (e: any) {
          logger.warn(`Failed to load workspace file ${filename}: ${e.message}`);
          return fallback;
        }
      };

      const manifest = readJson('manifest.json', {});
      const workflows = readJson('workflows.json', []);

      return {
        workspaceId: manifest.workspaceId || path.basename(workspacePath),
        workspacePath,
        workflows,
        manifest,
        agents: readJson('agents.json', []),
        tasks: readJson('tasks.json', []),
        chatSessions: readJson('chat-sessions.json', []),
        taskQueues: readJson('task-queues.json', []),
        promptTemplates: readJson('prompt-templates.json', []),
        skills: readJson('skills.json', []),
        mcpTools: readJson('mcp-tools.json', []),
        knowledge: readJson('knowledge.json', []),
        tags: readJson('tags.json', []),
        artifactIndex: readJson('artifact-index.json', []),
        executionLog: readJson('execution-log.json', []),
        updatedAt: new Date()
      };
    } catch (e: any) {
      logger.warn(`Failed to load workspace state: ${e.message}`);
      return null;
    }
  }

  /**
   * 保存状态
   */
  static saveState(state: WorkspaceState): void;
  static saveState(workspacePath: string, key: string, data: any): void;
  static saveState(arg1: WorkspaceState | string, key?: string, data?: any): void {
    if (typeof arg1 !== 'string') {
      this.states.set(arg1.workspaceId, arg1);
      return;
    }

    const fs = require('fs');
    const path = require('path');
    const workspacePath = arg1;
    const filename = key ? this.fileMap[key] : null;
    if (!filename) {
      logger.warn(`Unknown workspace state key: ${key}`);
      return;
    }

    const workflowsDir = path.join(workspacePath, 'WORKFLOWS');
    const filePath = path.join(workflowsDir, filename);
    const timerKey = `${workspacePath}:${filename}`;
    const existing = this.saveTimers.get(timerKey);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      try {
        if (!fs.existsSync(workflowsDir)) {
          fs.mkdirSync(workflowsDir, { recursive: true });
        }
        const tmpPath = filePath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tmpPath, filePath);
      } catch (e: any) {
        logger.error(`Failed to save workspace state ${filename}: ${e.message}`);
      } finally {
        this.saveTimers.delete(timerKey);
      }
    }, 500);

    if (timer.unref) timer.unref();
    this.saveTimers.set(timerKey, timer);
  }

  /**
   * 获取状态
   */
  static getState(workspaceId: string): WorkspaceState | undefined {
    return this.states.get(workspaceId);
  }

  /**
   * 获取历史记录
   */
  static getHistory(): WorkspaceState[] {
    return Array.from(this.states.values());
  }

  /**
   * 更新历史记录
   */
  static updateHistory(workspacePath: string): void {
    const fs = require('fs');
    const path = require('path');

    try {
      const workspaceId = path.basename(workspacePath);
      const existing = this.states.get(workspaceId);

      if (existing) {
        existing.updatedAt = new Date();
      } else {
        const state: WorkspaceState = {
          workspaceId,
          path: workspacePath,
          name: workspaceId,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        this.states.set(workspaceId, state);
      }
    } catch (e) {
      // Silent fail
    }
  }

  /**
   * 备份工作流文件夹
   */
  static backupWorkflowsFolder(workspacePath: string): void {
    const fs = require('fs');
    const path = require('path');
    const workflowsDir = path.join(workspacePath, 'WORKFLOWS');
    const backupDir = path.join(workspacePath, '.BACKUP', 'WORKFLOWS');

    if (!fs.existsSync(workflowsDir)) return;

    try {
      if (!fs.existsSync(path.join(workspacePath, '.BACKUP'))) {
        fs.mkdirSync(path.join(workspacePath, '.BACKUP'), { recursive: true });
      }
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const entries = fs.readdirSync(workflowsDir);
      for (const entry of entries) {
        const src = path.join(workflowsDir, entry);
        const dest = path.join(backupDir, entry);
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, dest);
        }
      }
    } catch (e) {
      // Silent fail for backup
    }
  }

  /**
   * 恢复工作流文件夹
   */
  static restoreWorkflowsFolder(workspacePath: string): boolean {
    const fs = require('fs');
    const path = require('path');
    const backupDir = path.join(workspacePath, '.BACKUP', 'WORKFLOWS');
    const workflowsDir = path.join(workspacePath, 'WORKFLOWS');

    if (!fs.existsSync(backupDir)) return false;

    try {
      if (!fs.existsSync(workflowsDir)) {
        fs.mkdirSync(workflowsDir, { recursive: true });
      }

      const entries = fs.readdirSync(backupDir);
      for (const entry of entries) {
        const src = path.join(backupDir, entry);
        const dest = path.join(workflowsDir, entry);
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, dest);
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }
}

module.exports = WorkspaceStateService;
