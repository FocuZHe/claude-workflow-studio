# 服务器端延迟与稳定性优化方案

> 基于代码深度分析，按优先级排列的修复计划

---

## 问题总览

| 优先级 | 问题数 | 影响范围 |
|--------|--------|---------|
| 🔴 CRITICAL | 4 | 服务器崩溃、数据损坏 |
| 🟠 HIGH | 5 | 严重延迟、功能阻塞 |
| 🟡 MEDIUM | 6 | 性能下降、内存泄漏 |
| 🟢 LOW | 5 | 轻微影响 |

---

## 🔴 CRITICAL — 必须立即修复

### C1: `process.env` 并发竞态条件

**文件：** `SdkService.ts:970-981`

**问题：** 多个并发 SDK 调用同时操作 `process.env`，会导致认证令牌永久丢失。

```
时间线：
T1: Call A 删除 ANTHROPIC_AUTH_TOKEN
T2: Call B 进入，发现 token 已不存在，savedAuthToken = undefined
T3: Call A 恢复 ANTHROPIC_AUTH_TOKEN
T4: Call B 尝试恢复 undefined → 永久丢失！
```

**修复方案：** 使用互斥锁保护环境变量操作

```typescript
// 新增：环境变量操作互斥锁
private _envMutex = Promise.resolve();

// 修改 _executeInternal 和 _spawnCliAgent 中的环境变量操作
private async _withEnvLock<T>(fn: () => Promise<T>): Promise<T> {
  this._envMutex = this._envMutex.then(async () => {
    const savedAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const savedApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      return await fn();
    } finally {
      if (savedAuthToken) process.env.ANTHROPIC_AUTH_TOKEN = savedAuthToken;
      if (savedApiKey) process.env.ANTHROPIC_API_KEY = savedApiKey;
    }
  });
  return this._envMutex;
}

// 使用方式
const client = await this._withEnvLock(async () => {
  return new Anthropic(clientOpts);
});
```

---

### C2: `execSync` 阻塞事件循环

**文件：** `SdkService.ts:1949`

**问题：** `_handleToolCall` 中使用 `execSync` 执行 bash 命令，最长阻塞 60 秒。期间所有 WebSocket 消息、HTTP 请求、其他 Agent 回调全部排队。

**修复方案：** 改用 `exec` (异步版本)

```typescript
case 'bash':
case 'execute_command': {
  const { exec } = require('child_process');
  const cmd = toolInput.command || toolInput.cmd || '';
  if (!cmd) return { type: 'tool_result', tool_use_id: toolId, content: 'Error: No command provided' };

  const cwd = toolInput.working_dir
    ? path.resolve(workingDir, toolInput.working_dir)
    : workingDir;

  if (!cwd.startsWith(workingDir)) {
    return { type: 'tool_result', tool_use_id: toolId, content: 'Error: Working directory outside workspace' };
  }

  return new Promise((resolve) => {
    exec(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout: 60000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          type: 'tool_result',
          tool_use_id: toolId,
          content: `Command error (code ${error.status}): ${stderr || error.message}`,
        });
      } else {
        resolve({
          type: 'tool_result',
          tool_use_id: toolId,
          content: stdout || '(command executed successfully)',
        });
      }
    });
  });
}
```

**同理修复：** `_handleToolCall` 中所有 `fs.readFileSync` → `fs.readFile`，`fs.writeFileSync` → `fs.writeFile`

---

### C3: `_currentRunId` 静态变量竞态

**文件：** `WorkflowService.ts:177, 1304`

**问题：** `_currentRunId` 是静态类变量，并发执行的工作流会互相覆盖，导致检查点数据混乱。

**修复方案：** 改为实例级 Map

```typescript
// 替换静态变量
// private static _currentRunId: string;  // 删除

// 改为按 runId 隔离的上下文
private static _runContexts = new Map<string, {
  runId: string;
  agentCallIndex: number;
  executableNodes: Map<string, WorkflowNode>;
}>();

// 在执行开始时创建上下文
static setRunContext(runId: string, context: Partial<RunContext>) {
  WorkflowService._runContexts.set(runId, {
    runId,
    agentCallIndex: 0,
    executableNodes: new Map(),
    ...context,
  });
}

// 使用时从上下文获取
static getRunContext(runId: string): RunContext | undefined {
  return WorkflowService._runContexts.get(runId);
}

// 执行结束后清理
static clearRunContext(runId: string) {
  WorkflowService._runContexts.delete(runId);
}
```

---

### C4: 429 重试无限递归

**文件：** `SdkService.ts:1358-1364`

**问题：** 遇到 429 错误时递归调用自身，无深度限制。持续限流会导致栈溢出。

**修复方案：** 添加重试计数器和最大重试次数

```typescript
// 修改方法签名，添加重试计数
private async _executeWithClaudeSdk(
  taskId: string,
  agentId: string,
  prompt: string,
  config: TaskConfig = {},
  retryCount = 0  // 新增参数
): Promise<TaskResult> {
  const MAX_RETRIES = 3;

  try {
    // ... 原有逻辑 ...
  } catch (err) {
    // 429错误：等待后重试
    if ((err.status === 429 || err.message?.includes('429')) && retryCount < MAX_RETRIES) {
      const retryDelay = Math.min(5000 * Math.pow(2, retryCount), 30000); // 指数退避，最大30秒
      logger.warn(`Task ${taskId} hit rate limit (attempt ${retryCount + 1}/${MAX_RETRIES}), retrying in ${retryDelay/1000}s`);
      this._broadcastChunk(taskId, agentId, `\n[等待API恢复 ${retryDelay/1000}秒...]\n`, false);
      await new Promise(r => setTimeout(r, retryDelay));
      return this._executeWithClaudeSdk(taskId, agentId, prompt, config, retryCount + 1);
    }

    logger.error(`Task ${taskId} failed`, { error: err.message });
    throw err;
  }
}
```

---

## 🟠 HIGH — 尽快修复

### H1: 流式 API 调用无超时

**文件：** `SdkService.ts:1547`

**问题：** `client.messages.create({ stream: true })` 没有超时。API 挂起时，任务槽位永久占用。

**修复方案：** 使用 AbortController 添加请求级超时

```typescript
// 在 _runAgentLoop 中
const STREAM_TIMEOUT = 5 * 60 * 1000; // 5 分钟单次请求超时

for (let turn = 0; turn < maxTurns; turn++) {
  // 检查总超时
  if (Date.now() - startTime > timeoutMs) break;

  // 创建带超时的 AbortController
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), STREAM_TIMEOUT);

  try {
    const stream = await client.messages.create({
      ...requestParams,
      stream: true,
    }, { signal: abortController.signal });

    // 处理流...
    for await (const event of stream) {
      // ...
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
```

---

### H2: 子 Agent 无超时

**文件：** `SdkService.ts:2222, 2247`

**问题：** 子 Agent 没有超时机制，挂起的子 Agent 会永久占用并发槽位（最多 5 个）。

**修复方案：** 为子 Agent 添加独立超时

```typescript
private async _spawnSdkAgent(
  task: SubAgentTask,
  parentTaskId: string,
  callIndex: number,
  subAgentTimeout = 10 * 60 * 1000  // 默认 10 分钟超时
): Promise<AgentCallResult> {
  // 使用 Promise.race 实现超时
  const timeoutPromise = new Promise<AgentCallResult>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Sub-agent ${task.agentName} timed out after ${subAgentTimeout/1000}s`));
    }, subAgentTimeout);
  });

  const executionPromise = this._executeSubAgentInternal(task, parentTaskId, callIndex);

  try {
    return await Promise.race([executionPromise, timeoutPromise]);
  } catch (err) {
    if (err.message?.includes('timed out')) {
      // 清理超时的子 Agent 资源
      this._cleanupSubAgent(task.agentId);
      throw err;
    }
    throw err;
  }
}
```

---

### H3: `_cleanupSubagentProcesses` 使用 `execSync`

**文件：** `WorkflowService.ts:1108-1117`

**问题：** 工作流完成后同步执行 `netstat -ano`，阻塞事件循环最长 10 秒。

**修复方案：** 改为异步执行

```typescript
private static async _cleanupSubagentProcessesAsync(runId: string): Promise<void> {
  const { exec } = require('child_process');
  const util = require('util');
  const execAsync = util.promisify(exec);

  try {
    // Windows: 异步获取进程列表
    const { stdout } = await execAsync('netstat -ano', { timeout: 10000, windowsHide: true });
    // ... 处理逻辑 ...
  } catch (err) {
    logger.warn('Failed to cleanup subagent processes:', err.message);
  }
}

// 调用处改为异步
// 原来：WorkflowService._cleanupSubagentProcesses(runId);
// 改为：
WorkflowService._cleanupSubagentProcessesAsync(runId).catch(err => {
  logger.warn('Cleanup failed:', err.message);
});
```

---

### H4: `uncaughtException` 处理不当

**文件：** `app.ts:194-202`

**问题：** 未捕获异常后继续运行，进程处于未定义状态，可能导致数据损坏。

**修复方案：** 记录后优雅退出，由 PM2 重启

```typescript
process.on('uncaughtException', (err) => {
  logger.error('FATAL: Uncaught exception', { error: err.message, stack: err.stack });

  // 给日志写入一点时间
  setTimeout(() => {
    process.exit(1); // PM2 会自动重启
  }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('FATAL: Unhandled rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });

  // 不立即退出，但记录警告
  // 如果同一个 rejection 频繁出现，由监控报警
});
```

---

### H5: 健康检查阻塞事件循环

**文件：** `app.ts:125`

**问题：** `/api/health` 同步执行 `claude --version`，阻塞 1-3 秒。

**修复方案：** 缓存 CLI 版本，异步检查

```typescript
let cliVersionCache: { version: string; checkedAt: number } | null = null;
const CLI_VERSION_TTL = 5 * 60 * 1000; // 5 分钟缓存

app.get('/api/health', async (req, res) => {
  const mem = process.memoryUsage();
  const uptime = process.uptime();

  // 异步获取 CLI 版本（带缓存）
  let cliVersion = 'unknown';
  if (cliVersionCache && Date.now() - cliVersionCache.checkedAt < CLI_VERSION_TTL) {
    cliVersion = cliVersionCache.version;
  } else {
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);
      const { stdout } = await execAsync('claude --version', { timeout: 5000, windowsHide: true });
      cliVersion = stdout.trim().split('\n')[0];
      cliVersionCache = { version: cliVersion, checkedAt: Date.now() };
    } catch {
      cliVersion = 'unavailable';
    }
  }

  res.json({
    success: true,
    data: {
      status: 'healthy',
      uptime: Math.floor(uptime),
      memory: {
        rss: Math.floor(mem.rss / 1024 / 1024),
        heapUsed: Math.floor(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.floor(mem.heapTotal / 1024 / 1024),
      },
      cliVersion,
      activeTasks: SdkService.getActiveTaskCount?.() ?? 0,
      timestamp: new Date().toISOString(),
    },
  });
});
```

---

## 🟡 MEDIUM — 计划修复

### M1: 流式消息缺少前端缓冲

**问题：** 每个 token 单独推送，5 个 Agent 并发时浏览器卡死。

**修复方案：** 后端 50ms 合流缓冲

```typescript
// SdkService 新增消息缓冲
private _messageBuffers = new Map<string, {
  buffer: WSEvent[];
  timer: NodeJS.Timeout | null;
}>();

private _bufferBroadcast(taskId: string, event: WSEvent) {
  if (!this._messageBuffers.has(taskId)) {
    this._messageBuffers.set(taskId, { buffer: [], timer: null });
  }

  const buf = this._messageBuffers.get(taskId)!;
  buf.buffer.push(event);

  if (!buf.timer) {
    buf.timer = setTimeout(() => {
      const batch = buf.buffer.splice(0);
      buf.timer = null;
      // 一次性发送所有缓冲消息
      broadcast({
        type: 'agent.batch_progress',
        payload: { taskId, events: batch },
      });
    }, 50); // 50ms 合流
  }
}
```

---

### M2: `_completedTasks` Set 无限增长

**文件：** `SdkService.ts:98`

**修复方案：** 定期清理旧记录

```typescript
private _cleanupCompletedTasks() {
  // 只保留最近 1000 条
  const MAX_COMPLETED = 1000;
  if (this._completedTasks.size > MAX_COMPLETED) {
    const entries = Array.from(this._completedTasks);
    const toRemove = entries.slice(0, entries.length - MAX_COMPLETED);
    toRemove.forEach(entry => this._completedTasks.delete(entry));
    logger.debug(`Cleaned up ${toRemove.length} old completed task records`);
  }
}

// 在任务完成时调用
this._completedTasks.add(taskIdHash);
this._cleanupCompletedTasks();
```

---

### M3: `_callingTrees` 错误路径未清理

**文件：** `SdkService.ts:1348`

**修复方案：** 在 catch 块中添加清理

```typescript
} catch (err) {
  // 清理资源
  this.activeStreams.delete(taskId);
  this._taskWorkflowMap.delete(taskId);
  this._taskMetaMap?.delete(taskId);
  this._cleanupCallingTree(taskId);  // 新增：错误路径也清理

  // ... 其余错误处理 ...
}
```

---

### M4: `_waitForMasterCompletion` 轮询改为事件驱动

**文件：** `WorkflowService.ts:1810`

**修复方案：** 使用 EventEmitter 替代轮询

```typescript
// WorkflowService 新增事件发射器
private static _completionEvents = new EventEmitter();

// 工作流完成时发射事件
static _markWorkflowComplete(runId: string) {
  WorkflowService._completionEvents.emit(`complete:${runId}`, runId);
}

// 等待完成改为事件监听
private static _waitForMasterCompletion(runId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      WorkflowService._completionEvents.removeListener(`complete:${runId}`, onDone);
      reject(new Error('Workflow execution timeout'));
    }, timeoutMs);

    function onDone() {
      clearTimeout(timer);
      resolve(true);
    }

    WorkflowService._completionEvents.once(`complete:${runId}`, onDone);
  });
}
```

---

### M5: 熔断器按任务隔离

**文件：** `CircuitBreaker.ts`

**修复方案：** 使用任务级熔断器

```typescript
// 替换全局熔断器为任务级
private _circuitBreakers = new Map<string, CircuitBreaker>();

private _getCircuitBreaker(taskId: string): CircuitBreaker {
  if (!this._circuitBreakers.has(taskId)) {
    this._circuitBreakers.set(taskId, new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 30000,
    }));
  }
  return this._circuitBreakers.get(taskId)!;
}

// 任务完成后清理
private _cleanupCircuitBreaker(taskId: string) {
  this._circuitBreakers.delete(taskId);
}
```

---

### M6: 添加请求频率限制

**文件：** `app.ts`

**修复方案：** 添加 express-rate-limit

```typescript
import rateLimit from 'express-rate-limit';

// API 频率限制
const apiLimiter = rateLimit({
  windowMs: 1 * 1000, // 1 秒窗口
  max: 100,           // 每秒最多 100 个请求
  message: { success: false, error: { message: 'Too many requests', code: 'RATE_LIMIT' } },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiLimiter);

// WebSocket 消息频率限制（在 WS handler 中）
const wsMessageLimiter = new Map<string, { count: number; resetTime: number }>();

function checkWsRateLimit(clientId: string): boolean {
  const now = Date.now();
  const limit = wsMessageLimiter.get(clientId) || { count: 0, resetTime: now + 1000 };

  if (now > limit.resetTime) {
    limit.count = 0;
    limit.resetTime = now + 1000;
  }

  limit.count++;
  wsMessageLimiter.set(clientId, limit);
  return limit.count <= 50; // 每秒最多 50 条 WS 消息
}
```

---

## 🟢 LOW — 有空再改

### L1: `_loadCache` / `_saveCache` 异步化

```typescript
// 改为异步读写
private async _loadCacheAsync(): Promise<void> {
  try {
    const data = await fs.promises.readFile(this._cachePath, 'utf-8');
    this._taskCache = JSON.parse(data);
  } catch {
    this._taskCache = {};
  }
}

private async _saveCacheAsync(): Promise<void> {
  try {
    await fs.promises.writeFile(this._cachePath, JSON.stringify(this._taskCache, null, 2));
  } catch (err) {
    logger.warn('Failed to save task cache:', err.message);
  }
}
```

### L2: `_getFilesSnapshot` 异步化

```typescript
private async _getFilesSnapshotAsync(dir: string): Promise<FileSnapshot[]> {
  const results: FileSnapshot[] = [];
  const walk = async (currentDir: string) => {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const stat = await fs.promises.stat(fullPath);
        results.push({ path: fullPath, size: stat.size, mtime: stat.mtimeMs });
      }
    }
  };
  await walk(dir);
  return results;
}
```

### L3: 降低 JSON body 限制

```typescript
app.use(express.json({ limit: '10mb' })); // 从 50mb 降到 10mb
```

### L4: Chat 工作区移到持久目录

```typescript
// 替换 os.tmpdir() 为项目内目录
const CHAT_WORKSPACE = path.join(process.cwd(), '.chat-workspace');
```

### L5: `_sdkSessionIds` 定期清理

```typescript
private _cleanupSessionCache() {
  const MAX_SESSIONS = 100;
  if (this._sdkSessionIds.size > MAX_SESSIONS) {
    // 删除最旧的条目
    const entries = Array.from(this._sdkSessionIds.entries());
    const toRemove = entries.slice(0, entries.length - MAX_SESSIONS);
    toRemove.forEach(([key]) => this._sdkSessionIds.delete(key));
  }
}
```

---

## 实施顺序建议

```
第 1 天（稳定性，约 3 小时）：
├── C1: process.env 互斥锁（30分钟）
├── C2: execSync → exec 异步化（1小时）
├── C3: _currentRunId 实例化（30分钟）
├── C4: 429 重试深度限制（15分钟）
├── H4: uncaughtException 处理（15分钟）
└── H5: 健康检查缓存（30分钟）

第 2 天（延迟优化，约 3 小时）：
├── H1: 流式 API 超时（30分钟）
├── H2: 子 Agent 超时（30分钟）
├── H3: cleanupSubagent 异步化（30分钟）
├── M1: 消息缓冲合流（1小时）
└── M4: 轮询改事件驱动（30分钟）

第 3 天（资源管理，约 2 小时）：
├── M2: completedTasks 清理（15分钟）
├── M3: callingTrees 错误清理（15分钟）
├── M5: 熔断器按任务隔离（30分钟）
├── M6: 请求频率限制（30分钟）
└── L1-L5: 低优先级优化（30分钟）
```

---

## 预期效果

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 事件循环阻塞 | 最长 60 秒 | < 10ms |
| 并发安全 | env 竞态、runId 覆盖 | 互斥锁隔离 |
| API 限流恢复 | 无限递归崩溃 | 指数退避，最多 3 次 |
| 子 Agent 挂起 | 永久占用槽位 | 10 分钟超时自动清理 |
| 浏览器卡顿 | 每 token 渲染 | 50ms 合流缓冲 |
| 异常后状态 | 继续运行（脏状态） | 优雅退出 + PM2 重启 |
