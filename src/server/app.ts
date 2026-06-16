/**
 * Claude Workflow Studio - 主应用入口
 * TypeScript 版本
 */

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/auth');
const { rateLimit, safetyHeaders } = require('./middleware/safety');
const FileService = require('./services/FileService');
const WorkspaceStateService = require('./services/WorkspaceStateService');
const WorkspaceManager = require('./services/WorkspaceManager');
const BroadcastService = require('./services/BroadcastService');
const AgentService = require('./services/AgentService');
const ClaudeService = require('./services/ClaudeService');
const SdkService = require('./services/SdkService');
const ApiKeyService = require('./services/ApiKeyService');
const WorkflowService = require('./services/WorkflowService');
const SnapshotService = require('./services/SnapshotService');
const ChatService = require('./services/ChatService');
const TaskQueueService = require('./services/TaskQueueService');
const SafetyService = require('./services/SafetyService');
const WsServer = require('./ws/server');
const TagService = require('./services/TagService');

// Routes
const agentsRouter = require('./routes/agents');
const agentTemplatesRouter = require('./routes/agent-templates');
const workflowsRouter = require('./routes/workflows');
const tasksRouter = require('./routes/tasks');
const taskQueuesRouter = require('./routes/task-queues');
const filesRouter = require('./routes/files');
const createBroadcastRouter = require('./routes/broadcast');
const createClientsRouter = require('./routes/clients');
const historyRouter = require('./routes/history');
const alertsRouter = require('./routes/alerts');
const auditLogsRouter = require('./routes/audit');
const skillsRouter = require('./routes/skills');
const mcpToolsRouter = require('./routes/mcp-tools');
const workflowTemplatesRouter = require('./routes/workflow-templates');
const workspacesRouter = require('./routes/workspaces');
const promptTemplatesRouter = require('./routes/prompt-templates');
const chatRouter = require('./routes/chat');
const gitRouter = require('./routes/git');
const terminalRouter = require('./routes/terminal');
const resourcesRouter = require('./routes/resources');
const artifactsRouter = require('./routes/artifacts');
const reportsRouter = require('./routes/reports');
const memoryRouter = require('./routes/memory');
const safetyRouter = require('./routes/safety');
const knowledgeRouter = require('./routes/knowledge');
const apiKeysRouter = require('./routes/api-keys');
const TerminalService = require('./services/TerminalService');

// Create Express app
const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({
  origin: true,  // 允许所有来源（本地开发工具，无需限制）
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Security middleware（只启用无副作用的安全中间件）
app.use(rateLimit({ windowMs: 60000, max: 200 }));  // 200次/分钟，本地正常使用不会触发
app.use(safetyHeaders());  // 添加安全响应头
app.use(authMiddleware);

// Static files - 使用 config.staticDir 指向 src/client
app.use(express.static(config.staticDir));

// xterm.js 静态文件（从 node_modules 提供）
const nodeModulesDir = path.join(__dirname, '..', '..', 'node_modules');
app.use('/xterm/xterm', express.static(path.join(nodeModulesDir, '@xterm', 'xterm')));
app.use('/xterm/addon-fit', express.static(path.join(nodeModulesDir, '@xterm', 'addon-fit')));

// API routes
app.use('/api/agents', agentsRouter);
app.use('/api/agent-templates', agentTemplatesRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/task-queues', taskQueuesRouter);
app.use('/api/files', filesRouter);
app.use('/api/broadcast', createBroadcastRouter);
app.use('/api/clients', createClientsRouter);
app.use('/api/history', historyRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/audit', auditLogsRouter);
app.use('/api/audit-logs', auditLogsRouter);  // 兼容前端调用
app.use('/api/skills', skillsRouter);
app.use('/api/mcp-tools', mcpToolsRouter);
app.use('/api/workflow-templates', workflowTemplatesRouter);
app.use('/api/workspaces', workspacesRouter);
app.use('/api/prompt-templates', promptTemplatesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/git', gitRouter);
app.use('/api/terminal', terminalRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/artifacts', artifactsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/memory', memoryRouter);
app.use('/api/safety', safetyRouter);
app.use('/api/knowledge', knowledgeRouter);
app.use('/api/api-keys', apiKeysRouter);

// Auth key endpoint - 前端用于获取API key（仅允许本地访问）
app.get('/api/auth/key', (req: any, res: any) => {
  const clientIp = req.ip || req.connection?.remoteAddress || '';
  const isLocal = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1' || clientIp === 'localhost';
  if (!isLocal) {
    return res.status(403).json({ success: false, error: '仅允许本地访问' });
  }
  try {
    const { getApiKey } = require('./middleware/auth');
    const apiKey = getApiKey();
    res.json({ success: true, apiKey: apiKey || null });
  } catch (err) {
    res.json({ success: true, apiKey: null });
  }
});

// Workspace state endpoint - 前端用于获取当前工作区状态
app.get('/api/workspace-state', (req: any, res: any) => {
  try {
    const FileService = require('./services/FileService');
    const WorkspaceManager = require('./services/WorkspaceManager');
    const workspaceRoot = FileService.runtimeWorkspaceRoot || FileService.getWorkspaceRoot() || '';
    const activeWorkspaces = WorkspaceManager.getActive ? WorkspaceManager.getActive() : [];
    res.json({
      success: true,
      data: {
        state: {
          workspacePath: workspaceRoot,
          workspaceId: activeWorkspaces[0]?.id || null,
        },
        activeWorkspaces,
        agents: [],
        workflows: [],
        tasks: [],
      }
    });
  } catch (err) {
    res.json({ success: true, data: { state: {}, activeWorkspaces: [] } });
  }
});

// Health check - CLI版本缓存（避免每次请求阻塞事件循环）
let cliVersionCache: { available: boolean; checkedAt: number } | null = null;
const CLI_CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

app.get('/api/health', async (req: any, res: any) => {
  // 检查SDK配置状态
  let sdkConfigured = false;
  let configCount = 0;
  try {
    const configs = ApiKeyService.getAllConfigs();
    configCount = configs.length;
    sdkConfigured = configCount > 0;
  } catch (e) { /* ignore */ }

  // 检查CLI是否可用（异步 + 缓存，避免阻塞事件循环）
  let cliAvailable = false;
  if (cliVersionCache && Date.now() - cliVersionCache.checkedAt < CLI_CACHE_TTL) {
    cliAvailable = cliVersionCache.available;
  } else {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      await execAsync('claude --version', { timeout: 5000, windowsHide: true });
      cliAvailable = true;
      cliVersionCache = { available: true, checkedAt: Date.now() };
    } catch (e) {
      cliVersionCache = { available: false, checkedAt: Date.now() };
    }
  }

  res.json({
    success: true,
    data: {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      cli: {
        available: cliAvailable,
        version: cliAvailable ? 'Claude Code CLI' : null,
        compatible: true,
        message: cliAvailable ? null : 'CLI未安装（SDK模式可用）',
        warnings: []
      },
      sdk: {
        configured: sdkConfigured,
        configCount: configCount
      }
    }
  });
});

// SPA fallback - 所有非API请求返回 index.html（支持前端路由）
app.get('*', (req: any, res: any) => {
  if (req.path.startsWith('/api/') || req.path === '/ws') {
    // API 和 WebSocket 请求走错误处理
    return notFoundHandler(req, res);
  }
  // 其他请求返回 index.html（支持 SPA 路由）
  res.sendFile(path.join(config.staticDir, 'index.html'));
});

// Error handling
app.use(errorHandler);

// Initialize services
const broadcastService = new BroadcastService();
const claudeService = new ClaudeService(broadcastService);
const sdkService = new SdkService(broadcastService);

// Store services globally for access from routes
(global as any).__broadcastService = broadcastService;
(global as any).__claudeService = claudeService;
(global as any).__sdkService = sdkService;

// Store SafetyService on app for route access
app.set('safetyService', SafetyService);

// Initialize WebSocket server
const wsServer = new WsServer(broadcastService);
wsServer.attach(server);

// Initialize other services
WorkflowService.init(broadcastService, claudeService);
AgentService.init(broadcastService);
ChatService.init(broadcastService, claudeService);
TaskQueueService.init(broadcastService);
TerminalService.setBroadcastService(broadcastService);
WorkspaceManager.init();  // 恢复持久化的工作区

// 恢复上次的工作区路径
try {
  const currentWsFile = path.join(config.data.dir, 'current-workspace.json');
  if (fs.existsSync(currentWsFile)) {
    const wsData = JSON.parse(fs.readFileSync(currentWsFile, 'utf-8'));
    if (wsData.path) {
      FileService.setWorkspaceRoot(wsData.path);
      logger.info(`Restored workspace: ${wsData.path}`);
    }
  }
} catch (e) { /* ignore */ }

SnapshotService.init(FileService.getWorkspaceRoot() || '');

// Start server only when run directly (not when imported by tests)
const PORT = config.port ?? 3456;
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, config.host, () => {
    logger.info(`Server running at http://${config.host}:${PORT}`);
    logger.info(`WebSocket available at ws://${config.host}:${PORT}/ws`);
    logger.info(`Static files served from: ${config.staticDir}`);
    logger.info(`Workspace root: ${FileService.getWorkspaceRoot()}`);

    // Phase 3: 崩溃恢复 - 检查中断的工作流并标记状态
    try {
      WorkflowService.recoverInterruptedWorkflows();
    } catch (e: any) {
      logger.warn('Crash recovery check failed:', e.message);
    }
  });

  // Handle server errors (e.g., port already in use)
  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${PORT} is already in use. Please stop the other process first.`);
      // Don't crash - just log the error
    } else {
      logger.error('Server error:', err.message);
    }
  });
}

// Handle process errors
process.on('uncaughtException', (err: any) => {
  logger.error('FATAL: Uncaught Exception:', {
    message: err?.message || 'Unknown error',
    stack: err?.stack || 'No stack trace',
    code: err?.code,
    name: err?.name
  });
  // 给日志写入一点时间，然后优雅退出（PM2会自动重启）
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason: any, promise: any) => {
  logger.error('Unhandled Rejection:', {
    reason: reason?.message || reason || 'Unknown reason',
    stack: reason?.stack || 'No stack trace'
  });
});

// Log process signals for debugging
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM signal');
});
process.on('SIGINT', () => {
  logger.info('Received SIGINT signal');
});
process.on('exit', (code) => {
  logger.info(`Process exiting with code: ${code}`);
});

// Periodic health check logging
setInterval(() => {
  const memUsage = process.memoryUsage();
  logger.debug(`Health check - Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB used, ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB total`);
}, 60000); // Log every minute

/**
 * Returns the Express app without starting the server.
 * Used by tests to create their own server instance.
 */
function createApp() {
  return { app, server, broadcastService, wsServer };
}

module.exports = { app, createApp };
