const path = require('path');
const fs = require('fs');

// 项目根目录（从 dist/server 向上两级）
const PROJECT_ROOT = path.join(__dirname, '../..');
const DEFAULT_PORT = 3456;

function readPort(): number {
  if (!process.env.PORT) {
    return DEFAULT_PORT;
  }

  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return DEFAULT_PORT;
  }

  return port;
}

const config: any = {
  port: readPort(),
  host: process.env.HOST || '127.0.0.1',

  // Workspace root for file management
  workspaceRoot: process.env.WORKSPACE_ROOT || path.join(PROJECT_ROOT, 'workspace'),

  // Static files directory - 指向 src/client（前端源文件）
  staticDir: path.join(PROJECT_ROOT, 'src/client'),

  // CORS settings
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
  },

  // WebSocket settings
  ws: {
    path: '/ws',
    heartbeatInterval: 30000,  // 30 seconds
    heartbeatTimeout: 60000    // 60 seconds
  },

  // Agent defaults
  agent: {
    defaultModel: 'sonnet',
    defaultTemperature: 0.7,
    maxLogs: 100
  },

  // Task defaults
  task: {
    defaultPriority: 'medium'
  },

  // Broadcast
  broadcast: {
    maxHistory: 50
  },

  // Data persistence
  data: {
    dir: process.env.DATA_DIR || path.join(__dirname, '../../data'),
    agentsFile: 'agents.json',
    workflowsFile: 'workflows.json',
    tasksFile: 'tasks.json',
    taskQueuesFile: 'task-queues.json',
    promptTemplatesFile: 'prompt-templates.json',
    chatSessionsFile: 'chat-sessions.json'
  },

  // Logging
  log: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || path.join(__dirname, '../../logs')
  },

  /**
   * Validate configuration at startup. Logs warnings for unsafe values.
   */
  validate(): string[] {
    const warnings: string[] = [];

    // PORT: must be a valid port number. 0 is allowed in tests for random ports.
    if (process.env.PORT) {
      const raw = Number(process.env.PORT);
      if (!Number.isInteger(raw) || raw < 0 || raw > 65535) {
        warnings.push(`PORT 环境变量值无效: "${process.env.PORT}"，已回退到默认值 ${config.port}`);
      }
    }

    // Static directory must exist
    if (!fs.existsSync(config.staticDir)) {
      warnings.push(`静态文件目录不存在: ${config.staticDir}，前端资源将无法加载`);
    }

    // Data directory should be writable
    try {
      if (!fs.existsSync(config.data.dir)) {
        fs.mkdirSync(config.data.dir, { recursive: true });
      }
    } catch (e: any) {
      warnings.push(`数据目录不可写: ${config.data.dir} (${e.message})`);
    }

    // Agent default model
    if (!config.agent.defaultModel || typeof config.agent.defaultModel !== 'string') {
      warnings.push('Agent 默认模型名无效');
    }

    // Task default priority
    const validPriorities = ['low', 'medium', 'high', 'critical'];
    if (!validPriorities.includes(config.task.defaultPriority)) {
      warnings.push(`Task 默认优先级无效: "${config.task.defaultPriority}"，有效值: ${validPriorities.join(', ')}`);
    }

    // Validate WebSocket intervals
    if (typeof config.ws.heartbeatInterval !== 'number' || config.ws.heartbeatInterval < 5000) {
      warnings.push('WebSocket 心跳间隔应至少为 5000ms');
    }

    if (typeof config.ws.heartbeatTimeout !== 'number' || config.ws.heartbeatTimeout < 10000) {
      warnings.push('WebSocket 心跳超时应至少为 10000ms');
    }

    return warnings;
  }
};

module.exports = config;
