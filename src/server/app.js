const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const path = require('path');

const config = require('./config');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
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
const WsServer = require('./ws/server');

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

const TagService = require('./services/TagService');
const KnowledgeService = require('./services/KnowledgeService');
const auditMiddleware = require('./middleware/audit');
const AuditService = require('./services/AuditService');
const { authMiddleware, getApiKey } = require('./middleware/auth');
const { rateLimit, sanitizeInput, detectThreats, safetyHeaders } = require('./middleware/safety');

/**
 * Create and configure the Express application
 * @returns {{ app, broadcastService, claudeService }}
 */
function createApp() {
  const app = express();

  // Initialize services
  const broadcastService = new BroadcastService();
  const claudeService = new ClaudeService(broadcastService);
  const sdkService = new SdkService(broadcastService);

  // Inject BroadcastService into AgentService
  AgentService.init(broadcastService);

  // Inject dependencies into WorkflowService (SDK primary, CLI fallback)
  WorkflowService.init(broadcastService, sdkService);
  global.__claudeService = claudeService;
  global.__sdkService = sdkService;

  // Reset nodes that were waiting for human intervention when server restarted
  WorkflowService.resetStuckNodes();

  // 注入 BroadcastService 和 SdkService 到 TaskService（用于任务执行和广播）
  const TaskService = require('./services/TaskService');
  TaskService.init(broadcastService, sdkService);

  // 注入 BroadcastService 和 TaskService 到 TaskQueueService
  const TaskQueueService = require('./services/TaskQueueService');
  TaskQueueService.init(broadcastService, TaskService);

  // 注入 BroadcastService 和 SdkService 到 ChatService
  const ChatService = require('./services/ChatService');
  ChatService.init(broadcastService, sdkService);

  // Initialize SafetyService
  const SafetyService = require('./services/SafetyService');
  const safetyService = new SafetyService(config.workspaceRoot);
  app.set('safetyService', safetyService);

  // 注入 BroadcastService 到 TerminalService
  const TerminalService = require('./services/TerminalService');
  TerminalService.init(broadcastService);

  // ---- Core Middleware ----
  app.use(cors(config.cors));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan('short', {
    stream: { write: (msg) => logger.info(msg.trim()) }
  }));

  // ---- Audit Middleware (before routes) ----
  app.use(auditMiddleware);

  // ---- Safety & Auth Middleware ----
  app.use(safetyHeaders());
  app.use(sanitizeInput());
  app.use(detectThreats());
  app.use(authMiddleware);

  // ---- Auth Key Endpoint (skipped by auth middleware) ----
  app.get('/api/auth/key', (req, res) => {
    res.json({ success: true, apiKey: getApiKey() });
  });

  // ---- Static Files (before rate limiting) ----
  app.use('/xterm', express.static(path.join(__dirname, '../../node_modules/@xterm')));
  app.use(express.static(config.staticDir));

  // ---- Rate Limiting ----
  // 全局限流：每 IP 每分钟 600 次请求
  const globalLimiter = rateLimit({ max: 600, windowMs: 60000 });
  app.use('/api', globalLimiter);

  // 写操作加强限流：每 IP 每 10 秒 200 次
  const writeRateLimiter = rateLimit({ max: 200, windowMs: 10000 });
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    writeRateLimiter(req, res, next);
  });

  // 登录端点严格限流：每 IP 每分钟 10 次（防暴力破解）
  const authLimiter = rateLimit({ max: 10, windowMs: 60000, message: '认证请求过于频繁，请稍后再试' });
  app.use('/api/auth', authLimiter);

  // ---- Health Check ----
  app.get('/api/health', async (req, res) => {
    // CLI check: 3s max, non-blocking via Promise.race
    const cliStatus = await Promise.race([
      claudeService.checkAvailability().catch(() => ({ available: false })),
      new Promise(r => setTimeout(() => r({ available: false, message: 'timeout' }), 3000))
    ]);
    const configs = ApiKeyService.getAllConfigs();
    res.json({
      success: true,
      data: {
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        cli: cliStatus,
        sdk: { configured: configs.length > 0, configCount: configs.length },
      }
    });
  });

  // ---- API Routes ----
  app.use('/api/agents', agentsRouter);
  app.use('/api/agent-templates', agentTemplatesRouter);
  app.use('/api/workflows', workflowsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/task-queues', taskQueuesRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/broadcast', createBroadcastRouter(broadcastService));
  app.use('/api/clients', createClientsRouter(broadcastService));
  app.use('/api/history', historyRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/audit-logs', auditLogsRouter);
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
  app.use('/api/keys', apiKeysRouter);


  // ---- Workspace State Endpoints ----
  app.get('/api/workspace-state', (req, res) => {
    const workspaceRoot = FileService.getWorkspaceRoot();
    if (!workspaceRoot) {
      return res.json({
        success: true,
        data: { loaded: false, message: 'No active workspace' }
      });
    }
    const state = WorkspaceStateService.loadState(workspaceRoot);
    res.json({
      success: true,
      data: { loaded: !!state, state }
    });
  });

  app.get('/api/workspace-history', (req, res) => {
    const history = WorkspaceStateService.getHistory();
    res.json({
      success: true,
      data: history
    });
  });

  // ---- SPA Fallback ----
  // For any non-API route, serve index.html (SPA support)
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    const indexPath = path.join(config.staticDir, 'index.html');
    const fs = require('fs');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });

  // ---- 404 Handler ----
  app.use(notFoundHandler);

  // ---- Error Handler ----
  app.use(errorHandler);

  // Store services on app for external access
  app.locals.broadcastService = broadcastService;
  app.locals.claudeService = claudeService;

  return { app, broadcastService, claudeService };
}

/**
 * Start the server
 */
async function startServer() {
  // Initialize sql.js engine before any DataStore is used
  const DataStore = require('./utils/DataStore');
  await DataStore.init();

  // Load persisted audit logs from disk
  AuditService.loadFromDisk();

  const { app, broadcastService, claudeService } = createApp();
  const server = http.createServer(app);
  const wsServer = new WsServer(broadcastService);

  // Attach WebSocket server
  wsServer.attach(server);

  // Ensure workspace directory exists
  FileService.ensureWorkspace();

  // Restore active workspaces from active-workspaces.json
  try {
    WorkspaceManager.restoreAll();
    const activePath = FileService.runtimeWorkspaceRoot;
    if (activePath) {
      // Call setWorkspaceRoot to reload all models (workflows, tasks, chat sessions, etc.)
      // from disk into memory. restoreAll()/activate() only registers workspaces in the Map
      // but does NOT populate the in-memory models.
      FileService.setWorkspaceRoot(activePath);
      // Persist current-workspace.json with the correct path
      // (activate() skips _persist() for already-active workspaces)
      WorkspaceManager._persist();
      logger.info(`Workspace restored: ${activePath}`);
    } else {
      logger.info('No active workspaces — system starts without workspace');
    }
  } catch (e) {
    logger.warn(`Failed to restore workspaces: ${e.message}`);
  }

  // Reset stuck/stale nodes after workspace state is loaded
  try {
    WorkflowService.resetStuckNodes();
  } catch (e) {
    logger.warn(`Failed to activate default workspace: ${e.message}`);
  }

  // Initialize new services (artifact index, checkpoints, reports, memory)
  try {
    const ArtifactIndexService = require('./services/ArtifactIndexService');
    const CheckpointService = require('./services/CheckpointService');
    const ReportService = require('./services/ReportService');
    const MemoryService = require('./services/MemoryService');

    const workspaceRoot = FileService.getWorkspaceRoot();
    if (workspaceRoot) {
      ArtifactIndexService.init(workspaceRoot);
      CheckpointService.init(workspaceRoot);
      ReportService.init(workspaceRoot);
      MemoryService.init(workspaceRoot);
      SnapshotService.init(workspaceRoot);
      TagService.init(workspaceRoot);
      KnowledgeService.init(workspaceRoot);
    }
  } catch (e) {
    logger.warn(`Failed to initialize new services: ${e.message}`);
  }

  // Reset stuck task queues on startup
  try {
    const TaskQueueService = require('./services/TaskQueueService');
    TaskQueueService.resetStuckQueues();
  } catch (e) {
    logger.warn(`Failed to reset stuck task queues: ${e.message}`);
  }

  // Seed preset prompt templates if they don't exist
  try {
    const PromptTemplateModel = require('./models/PromptTemplate');
    const PRESET_TEMPLATES = [
      {
        name: '代码审查',
        description: '审查代码质量、性能、安全性和可维护性',
        category: 'preset',
        preset: true,
        content: '请审查以下代码，按严重度分级列出问题：\n\n🔴 致命：安全漏洞、数据丢失风险\n🟡 警告：性能问题、潜在 Bug\n🔵 建议：代码风格、可维护性改进\n\n每个问题包含：位置 → 问题描述 → 影响评估 → 修复建议\n\n代码：\n{{code}}'
      },
      {
        name: 'Bug 修复',
        description: '系统化分析并修复代码缺陷',
        category: 'preset',
        preset: true,
        content: '请分析并修复以下 Bug：\n\n## 问题描述\n{{description}}\n\n## 错误信息\n{{error}}\n\n## 相关代码\n{{code}}\n\n## 输出要求\n1. 根因分析：为什么出现这个问题\n2. 复现条件：什么情况下会触发\n3. 修复方案：完整的修复代码\n4. 预防措施：如何避免同类问题'
      },
      {
        name: '功能开发',
        description: '从需求到实现的全流程开发',
        category: 'preset',
        preset: true,
        content: '请实现以下功能：\n\n## 功能描述\n{{description}}\n\n## 技术要求\n{{requirements}}\n\n## 现有代码\n{{code}}\n\n## 输出要求\n1. 实现代码（完整的源文件）\n2. 使用示例或测试用例\n3. 修改的文件清单\n4. 注意事项（兼容性、依赖变更等）'
      },
      {
        name: '代码重构',
        description: '优化代码结构，消除技术债务',
        category: 'preset',
        preset: true,
        content: '请重构以下代码：\n\n## 重构目标\n{{goal}}\n\n## 当前代码\n{{code}}\n\n## 输出要求\n1. 问题分析：当前代码存在哪些问题\n2. 重构方案：采用的设计模式或改进思路\n3. 重构后代码：完整的优化版本\n4. 变更对比：关键改动点及理由'
      },
      {
        name: 'API 文档',
        description: '生成规范的 API 接口文档',
        category: 'preset',
        preset: true,
        content: '请为以下 API 编写文档：\n\n## 接口信息\n{{endpoint}}\n\n## 代码\n{{code}}\n\n## 文档要求\n1. 接口概述：用途和使用场景\n2. 请求参数表：参数名 | 类型 | 必填 | 说明\n3. 响应格式：成功和失败示例\n4. 错误码表：错误码 | 含义 | 处理建议\n5. curl 调用示例'
      },
      {
        name: '单元测试',
        description: '编写全面的单元测试代码',
        category: 'preset',
        preset: true,
        content: '请为以下代码编写全面的单元测试：\n\n## 源代码\n{{code}}\n\n## 测试框架\n{{framework}}\n\n## 覆盖要求\n1. 正常场景：核心功能验证\n2. 边界情况：null/undefined/空值/极限值\n3. 异常场景：错误输入、超时、权限不足\n4. Mock/Stub：外部依赖的模拟\n\n## 输出\n- 每个测试标注场景描述和预期结果\n- 预估覆盖率'
      },
      {
        name: 'SQL 查询',
        description: '编写高效、安全的 SQL 语句',
        category: 'preset',
        preset: true,
        content: '请编写优化的 SQL 查询：\n\n## 查询需求\n{{description}}\n\n## 表结构\n{{schema}}\n\n## 输出要求\n1. SQL 语句（带注释说明每个子句的作用）\n2. 索引建议（哪些列需要索引及原因）\n3. 性能分析（预估扫描行数、执行计划要点）\n4. 注入防护说明'
      },
      {
        name: 'Git 提交',
        description: '生成规范的 commit message',
        category: 'preset',
        preset: true,
        content: '请为以下变更编写规范的 git commit message：\n\n## 变更内容\n{{changes}}\n\n要求：遵循 Conventional Commits 格式\n格式：<type>(<scope>): <subject>\n\n类型：feat/fix/docs/refactor/test/chore\n主题限制 50 字符，正文每行 72 字符\n\n## 输出\n标题：简短精确描述\n正文：变更原因和影响\n脚注：关联的 issue/PR 编号'
      }
    ];
    let seededCount = 0;
    for (const tpl of PRESET_TEMPLATES) {
      if (!PromptTemplateModel.findByName(tpl.name)) {
        PromptTemplateModel.create(tpl);
        seededCount++;
      }
    }
    if (seededCount > 0) {
      logger.info(`Seeded ${seededCount} preset prompt templates`);
    }
  } catch (e) {
    logger.warn(`Failed to seed preset prompt templates: ${e.message}`);
  }

  // Store wsServer on app
  app.locals.wsServer = wsServer;

  // Check Claude CLI availability on startup (best-effort, non-blocking)
  claudeService.checkAvailability().then(status => {
    if (status.available) logger.info(`Claude CLI: ${status.version}`);
    else logger.info('Claude CLI not available — SDK mode only. Configure API Key in Settings.');
  }).catch(() => {});

  // Validate configuration before starting
  const configWarnings = config.validate();
  if (configWarnings.length > 0) {
    logger.warn(`[CONFIG] ${configWarnings.length} 个配置警告:`);
    configWarnings.forEach(w => logger.warn(`[CONFIG] ${w}`));
  }

  // Start listening
  server.listen(config.port, config.host, () => {
    logger.info(`Server running at http://${config.host}:${config.port}`);
    logger.info(`WebSocket available at ws://${config.host}:${config.port}${config.ws.path}`);
    logger.info(`Static files served from: ${config.staticDir}`);
    logger.info(`Workspace root: ${config.workspaceRoot}`);
  });

  // Periodic auto-flush: ensure in-memory data is persisted every 2 seconds.
  // Mitigates data loss from SIGKILL / kill -9 where graceful shutdown cannot run.
  const AUTO_FLUSH_INTERVAL = setInterval(() => {
    const models = ['Agent', 'Workflow', 'Task', 'TaskQueue', 'ChatSession', 'PromptTemplate'];
    for (const name of models) {
      try {
        const Model = require(`./models/${name}`);
        if (Model._persistPending) Model._flush();
      } catch (e) { /* ignore */ }
    }
    // Flush audit logs
    try {
      if (AuditService._persistPending) AuditService._doPersist();
    } catch (e) { /* ignore */ }
  }, 2000);
  // Allow the event loop to exit when no other work is pending
  if (AUTO_FLUSH_INTERVAL.unref) AUTO_FLUSH_INTERVAL.unref();

  // Global error protection
  process.on('uncaughtException', (err) => {
    logger.error(`[UNCAUGHT] ${err.message}\n${err.stack}`);
    // Per Node.js docs: an uncaughtException means the application is in an
    // undefined state. Attempt a graceful shutdown flush, then exit.
    try {
      const models = ['Agent', 'Workflow', 'Task', 'TaskQueue', 'ChatSession', 'PromptTemplate'];
      for (const name of models) {
        try { require(`./models/${name}`)._flush(); } catch (e) { /* ignore */ }
      }
      try { require('./services/WorkspaceStateService')._flushAll(); } catch (e) { /* ignore */ }
      try { if (AuditService._persistPending) AuditService._doPersist(); } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`[UNHANDLED_REJECTION] ${reason?.message || reason}`);
  });

  // Graceful shutdown — flush all in-memory data before exiting
  function gracefulShutdown(signal) {
    logger.info(`${signal} received, shutting down gracefully...`);

    // Save current workspace path for restart recovery
    try {
      const currentPath = FileService.runtimeWorkspaceRoot || null;
      const currentFile = path.join(config.data.dir, 'current-workspace.json');
      const fs = require('fs');
      fs.writeFileSync(currentFile, JSON.stringify({ path: currentPath }, null, 2), 'utf-8');
    } catch (e) { /* ignore */ }

    // Flush each model's pending writes synchronously
    const models = ['Agent', 'Workflow', 'Task', 'TaskQueue', 'ChatSession', 'PromptTemplate'];
    for (const name of models) {
      try {
        const Model = require(`./models/${name}`);
        if (typeof Model._flush === 'function') {
          Model._flush();
        }
      } catch (e) {
        // model file may not exist yet
      }
    }

    // Flush audit logs
    try {
      if (AuditService._persistPending) AuditService._doPersist();
    } catch (e) { /* ignore */ }

    // Also flush any pending workspace state writes
    try {
      const WorkspaceStateService = require('./services/WorkspaceStateService');
      if (typeof WorkspaceStateService._flushAll === 'function') {
        WorkspaceStateService._flushAll();
      }
    } catch (e) { /* ignore */ }

    // Flush terminal session output buffers to disk
    try {
      const TerminalService = require('./services/TerminalService');
      if (typeof TerminalService._flushAll === 'function') {
        TerminalService._flushAll();
      }
    } catch (e) { /* ignore */ }

    // Stop file watcher (clears debounce timer) and flush artifact index
    try {
      const ArtifactIndexService = require('./services/ArtifactIndexService');
      ArtifactIndexService.stopWatching();
    } catch (e) { /* ignore */ }

    wsServer.close();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });

    // Safety: if server hasn't closed within 5s, force exit
    setTimeout(() => {
      logger.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 5000);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return { app, server, broadcastService, claudeService, wsServer };
}

// Start if run directly
if (require.main === module) {
  startServer();
}

module.exports = { createApp, startServer };
