/**
 * WorkspaceStateService - 工作区状态服务
 * 管理工作区状态持久化（WORKFLOWS 目录下各 JSON 文件）
 *
 * saveState(workspacePath, key, data) —— 按文件 key 异步（debounced）写入
 *   key 与文件名映射见 STATE_FILE_MAP
 * loadState(workspacePath) —— 读取所有相关 JSON 并合并为单一 state 对象
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
  skills?: any[];
  mcpTools?: any[];
  executionLog?: any[];
  chatSessions?: any[];
  taskQueues?: any[];
  promptTemplates?: any[];
  manifest?: any;
  knowledge?: any[];
  tags?: any[];
  artifactIndex?: any[];
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * state key -> 文件名（位于 WORKFLOWS/ 下）映射
 */
const STATE_FILE_MAP: Record<string, string> = {
  workflows: 'workflows.json',
  agents: 'agents.json',
  tasks: 'tasks.json',
  skills: 'skills.json',
  mcpTools: 'mcp-tools.json',
  mcpToolsAlias: 'mcp-tools.json',
  executionLog: 'execution-log.json',
  executionLogAlias: 'execution-log.json',
  chatSessions: 'chat-sessions.json',
  'chat-sessions': 'chat-sessions.json',
  taskQueues: 'task-queues.json',
  'task-queues': 'task-queues.json',
  promptTemplates: 'prompt-templates.json',
  'prompt-templates': 'prompt-templates.json',
  knowledge: 'knowledge.json',
  tags: 'tags.json',
  artifactIndex: 'artifact-index.json',
  manifest: 'manifest.json'
};

/**
 * 反向映射：文件名（不含路径）-> state key
 */
const FILE_TO_KEY: Record<string, string> = {
  'workflows.json': 'workflows',
  'agents.json': 'agents',
  'tasks.json': 'tasks',
  'skills.json': 'skills',
  'mcp-tools.json': 'mcpTools',
  'execution-log.json': 'executionLog',
  'chat-sessions.json': 'chatSessions',
  'task-queues.json': 'taskQueues',
  'prompt-templates.json': 'promptTemplates',
  'knowledge.json': 'knowledge',
  'tags.json': 'tags',
  'artifact-index.json': 'artifactIndex',
  'manifest.json': 'manifest'
};

export class WorkspaceStateService {
  private static states: Map<string, WorkspaceState> = new Map();
  /** saveState debounce 定时器，key = `${workspacePath}|${stateKey}` */
  private static saveTimers: Map<string, NodeJS.Timeout> = new Map();
  private static readonly SAVE_DEBOUNCE_MS = 500;

  /**
   * 确保工作流文件夹存在，并创建所有必要的目录和默认 JSON 文件
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

      // 创建必要的 JSON 文件（如果不存在）—— 默认空数组
      const jsonFiles: Record<string, any> = {
        'WORKFLOWS/manifest.json': { workspaceId: path.basename(workspacePath), version: '1.0.0', createdAt: new Date().toISOString() },
        'WORKFLOWS/workflows.json': [],
        'WORKFLOWS/agents.json': [],
        'WORKFLOWS/tasks.json': [],
        'WORKFLOWS/skills.json': [],
        'WORKFLOWS/mcp-tools.json': [],
        'WORKFLOWS/execution-log.json': [],
        'WORKFLOWS/chat-sessions.json': [],
        'WORKFLOWS/task-queues.json': [],
        'WORKFLOWS/prompt-templates.json': [],
        'WORKFLOWS/knowledge.json': [],
        'WORKFLOWS/tags.json': [],
        'WORKFLOWS/artifact-index.json': []
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
   * 加载工作区完整状态
   * 读取 WORKFLOWS/ 下所有相关 JSON 文件并合并为单一 state 对象
   */
  static loadState(workspacePath: string): WorkspaceState | null {
    const fs = require('fs');
    const path = require('path');

    try {
      const workflowsDir = path.join(workspacePath, 'WORKFLOWS');
      const state: any = {
        workspaceId: path.basename(workspacePath),
        workspacePath,
        updatedAt: new Date()
      };

      // 读取所有已知文件
      for (const [filename, stateKey] of Object.entries(FILE_TO_KEY)) {
        const fullPath = path.join(workflowsDir, filename);
        if (fs.existsSync(fullPath)) {
          try {
            const raw = fs.readFileSync(fullPath, 'utf-8');
            const parsed = raw ? JSON.parse(raw) : null;
            state[stateKey] = parsed;
          } catch (e: any) {
            logger.warn(`loadState: 解析 ${filename} 失败: ${e.message}`);
            state[stateKey] = null;
          }
        } else {
          // 文件不存在则默认空数组或空对象
          state[stateKey] = filename === 'manifest.json' ? {} : [];
        }
      }

      // manifest.workspaceId 优先
      if (state.manifest && state.manifest.workspaceId) {
        state.workspaceId = state.manifest.workspaceId;
      }

      return state;
    } catch (e: any) {
      logger.warn(`Failed to load workspace state: ${e.message}`);
      return null;
    }
  }

  /**
   * 保存工作区某个状态 key 到对应 JSON 文件（debounced 500ms）
   * 支持两种调用签名：
   *   saveState(workspacePath, key, data)  ← 推荐用法，写入磁盘
   *   saveState(state: WorkspaceState)     ← 兼容旧用法，仅写入内存 states Map
   */
  static saveState(workspacePathOrState: string | WorkspaceState, key?: string, data?: any): void {
    // 兼容旧签名：saveState(state)
    if (typeof workspacePathOrState !== 'string') {
      const state = workspacePathOrState as WorkspaceState;
      if (state && state.workspaceId) {
        this.states.set(state.workspaceId, state);
      }
      return;
    }

    // 新签名：saveState(workspacePath, key, data)
    const workspacePath = workspacePathOrState;
    if (!workspacePath || !key) {
      logger.warn('saveState: 缺少必要参数 workspacePath 或 key');
      return;
    }

    const filename = STATE_FILE_MAP[key];
    if (!filename) {
      logger.warn(`saveState: 未知 state key '${key}'`);
      return;
    }

    const fs = require('fs');
    const path = require('path');
    const fullPath = path.join(workspacePath, 'WORKFLOWS', filename);
    const timerKey = `${workspacePath}|${key}`;

    // 取消已存在的定时器（debounce）
    const existingTimer = this.saveTimers.get(timerKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // 设置新的定时器
    const timer = setTimeout(() => {
      this.saveTimers.delete(timerKey);
      try {
        // 确保目录存在
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf-8');
      } catch (e: any) {
        logger.error(`saveState: 写入 ${filename} 失败: ${e.message}`);
      }
    }, this.SAVE_DEBOUNCE_MS);

    this.saveTimers.set(timerKey, timer);
  }

  /**
   * 强制 flush 所有 pending 的 saveState（用于测试或关闭时）
   */
  static flushPendingSaves(): void {
    for (const [, timer] of this.saveTimers) {
      clearTimeout(timer);
    }
    this.saveTimers.clear();
  }

  /**
   * 获取内存中的 state（与磁盘 loadState 不同）
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
   * 更新历史记录（内存）
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
