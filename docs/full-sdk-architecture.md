# 全SDK架构方案 - Claude Workflow Studio

## 一、核心架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        主Agent (SDK模式)                         │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  任务分解 → 并行调度 → 等待完成 → 汇总结果 → 串行执行      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│         ↓              ↓              ↓                          │
│    ┌─────────┐    ┌─────────┐    ┌─────────┐                    │
│    │子Agent1 │    │子Agent2 │    │子Agent3 │                    │
│    │ (SDK)   │    │ (SDK)   │    │ (SDK)   │                    │
│    └────┬────┘    └────┬────┘    └────┬────┘                    │
│         │              │              │                          │
│         ↓              ↓              ↓                          │
│    ┌─────────────────────────────────────────┐                  │
│    │         事件流 + OpenTelemetry           │                  │
│    │    (task_started, task_progress, etc)    │                  │
│    └─────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

## 二、功能清单

| 功能 | 实现方式 | 状态 |
|------|----------|------|
| 并行执行 | `Promise.allSettled` + `p-limit` | ✅ |
| 串行执行 | `await` 链式调用 | ✅ |
| 生命周期管理 | `AbortController` + `SIGKILL` | ✅ |
| 事件流机制 | 内部绑定 `task_started/progress/completed` | ✅ |
| Git隔离 | `git worktree`（异步） | ✅ |
| 冲突处理 | worktree隔离 + 幂等清理 | ✅ |
| 超时处理 | `setTimeout` + `abort` + 物理杀死 | ✅ |
| 网络自愈 | 识别网络错误 + 延长重试间隔 | ✅ |
| 并发控制 | `p-limit(5)` | ✅ |
| 资源清理 | `forcePruneWorktree` | ✅ |
| 状态持久化 | 标记为interrupted，用户手动恢复 | ✅ |
| 完整工具集 | read/write/execute/search | ✅ |
| 异步非阻塞 | `execAsync` | ✅ |
| 幂等性 | `forcePruneWorktree` | ✅ |
| 故障日志留存 | `logs/` 目录 + 时间戳 + git diff | ✅ |
| 广播到UI | `EventEmitter` + `broadcastToUI` | ✅ |
| 模型映射 | haiku/sonnet/opus 三个别名 | ✅ |

## 三、模型映射

```javascript
// ApiKeyService.js
static MODEL_ALIASES = {
  'haiku': 'claude-3-haiku-20240307',
  'sonnet': 'claude-3-5-sonnet-20241022',
  'opus': 'claude-3-opus-20240229',
};

static resolveModel(alias) {
  if (alias && ApiKeyService.MODEL_ALIASES[alias.toLowerCase()]) {
    return ApiKeyService.MODEL_ALIASES[alias.toLowerCase()];
  }
  const clientConfig = ApiKeyService.getClientConfig();
  return clientConfig.model || alias;
}
```

## 四、核心代码实现

### 4.1 MasterAgentOrchestrator 类

```javascript
const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs').promises;
const existsSync = require('fs').existsSync;
const pLimit = require('p-limit');
const EventEmitter = require('events');

const execAsync = util.promisify(exec);

// 网络错误代码
const NETWORK_ERRORS = [
  'ENOTFOUND',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
];

class MasterAgentOrchestrator extends EventEmitter {
  constructor(sdk, stateStore, workspaceRoot, logger) {
    super();
    this.sdk = sdk;
    this.stateStore = stateStore;
    this.workspaceRoot = workspaceRoot;
    this.logger = logger;
    this.concurrencyLimit = pLimit(5);
    
    // 确保 logs 目录存在
    this.logsDir = path.join(workspaceRoot, 'logs');
    fs.mkdir(this.logsDir, { recursive: true }).catch(() => {});
  }

  // 并行执行（异步非阻塞版）
  async executeParallel(tasks) {
    // 1. 并行创建 worktree
    const worktreePromises = tasks.map(async (t) => {
      const worktreePath = await this.createWorktree(t.id);
      return { ...t, worktree: worktreePath };
    });
    const tasksWithWorktree = await Promise.all(worktreePromises);

    // 2. 并发控制 + 启动子Agent
    const agentPromises = tasksWithWorktree.map(task =>
      this.concurrencyLimit(() => this.spawnAgentWithRetry(task))
    );

    // 3. 等待所有完成（容错模式）
    const results = await Promise.allSettled(agentPromises);

    // 4. 统一清理 worktree
    await this.cleanupWorktrees(tasksWithWorktree);

    // 5. 处理结果
    const succeeded = [];
    const failed = [];

    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        succeeded.push(r.value);
      } else {
        failed.push({
          taskId: tasksWithWorktree[idx].id,
          error: r.reason ? r.reason.message : 'Unknown error'
        });
      }
    });

    if (failed.length > 0) {
      this.logger.warn(`${failed.length} 个子Agent执行失败`, failed);
    }

    return { succeeded, failed };
  }

  // 带重试的子Agent启动（含网络自愈）
  async spawnAgentWithRetry(task, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.spawnAgent(task);
      } catch (err) {
        const isNetworkError = NETWORK_ERRORS.some(code => 
          err.message.includes(code) || err.code === code
        );
        
        if (attempt === maxRetries) {
          throw err;
        }
        
        // 网络错误延长重试间隔
        let delay;
        if (isNetworkError) {
          delay = [5000, 15000, 30000][attempt - 1]; // 5s, 15s, 30s
          this.logger.warn(
            `子Agent ${task.id} 网络错误(${err.code || err.message})，` +
            `${delay/1000}秒后重试(${attempt}/${maxRetries})`
          );
        } else {
          delay = [1000, 3000, 5000][attempt - 1]; // 1s, 3s, 5s
          this.logger.warn(
            `子Agent ${task.id} 失败，${delay/1000}秒后重试(${attempt}/${maxRetries})`
          );
        }
        
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // 生成子Agent核心逻辑
  async spawnAgent(task) {
    const abortController = new AbortController();
    const timeoutMs = task.timeout || 5 * 60 * 1000;
    
    // 创建日志文件
    const logFile = path.join(
      this.logsDir,
      `run_${task.id}_${Date.now()}.log`
    );
    const logStream = await fs.open(logFile, 'a');
    
    // 保存完整任务配置（用于崩溃恢复）
    await this.saveOrchestrationState(task.id, 'running', null, task);

    let agentInstance;
    let timeoutId;

    try {
      agentInstance = this.sdk.spawn({
        task: task.description,
        model: task.model || 'sonnet',
        workingDir: task.worktree,
        signal: abortController.signal,
      });

      // 绑定事件（含日志记录）
      this.attachEventListeners(agentInstance, logStream, task.id);

      const result = await new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
          abortController.abort('TIMEOUT');
        }, timeoutMs);

        agentInstance.on('task_completed', (data) => {
          resolve(data.result);
        });

        agentInstance.on('task_failed', (data) => {
          reject(new Error(data.error || 'Agent execution failed'));
        });

        // 物理杀死子进程
        abortController.signal.addEventListener('abort', () => {
          this.logger.warn(`任务 ${task.id} 触发终止(原因: ${abortController.signal.reason})`);
          
          // 记录故障现场
          this.captureCrashScene(task, logFile, abortController.signal.reason);
          
          if (agentInstance && typeof agentInstance.kill === 'function') {
            try {
              agentInstance.kill('SIGKILL'); 
            } catch (err) {
              this.logger.error(`无法物理杀死子Agent进程 ${task.id}`, err);
            }
          }
          reject(new Error(abortController.signal.reason || 'ABORTED'));
        });
      });

      clearTimeout(timeoutId);
      await this.saveOrchestrationState(task.id, 'completed');
      await logStream.close();
      
      return result;

    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      await this.saveOrchestrationState(task.id, 'failed', err.message);
      await logStream.close();
      throw err;
    }
  }

  // 绑定事件监听（含日志记录）
  attachEventListeners(agentInstance, logStream, taskId) {
    agentInstance.on('task_started', (data) => {
      this.logger.info(`子Agent ${data.agentId} 开始`);
      this.broadcastToUI('agent:started', data);
      this.writeLog(logStream, `[STARTED] ${JSON.stringify(data)}`);
    });

    agentInstance.on('task_progress', (data) => {
      this.logger.info(`子Agent ${data.agentId} 进度: ${data.progress}%`);
      this.broadcastToUI('agent:progress', data);
      this.writeLog(logStream, `[PROGRESS] ${JSON.stringify(data)}`);
    });

    agentInstance.on('task_completed', (data) => {
      this.logger.info(`子Agent ${data.agentId} 完成`);
      this.broadcastToUI('agent:completed', data);
      this.writeLog(logStream, `[COMPLETED] ${JSON.stringify(data)}`);
    });

    agentInstance.on('task_failed', (data) => {
      this.logger.warn(`子Agent ${data.agentId} 失败: ${data.error}`);
      this.broadcastToUI('agent:failed', data);
      this.writeLog(logStream, `[FAILED] ${JSON.stringify(data)}`);
    });

    // 捕获 stdout/stderr
    if (agentInstance.stdout) {
      agentInstance.stdout.on('data', (data) => {
        this.writeLog(logStream, `[STDOUT] ${data.toString()}`);
      });
    }
    if (agentInstance.stderr) {
      agentInstance.stderr.on('data', (data) => {
        this.writeLog(logStream, `[STDERR] ${data.toString()}`);
      });
    }
  }

  // 写入日志
  async writeLog(logStream, content) {
    try {
      await logStream.write(`[${new Date().toISOString()}] ${content}\n`);
    } catch (_) {}
  }

  // 捕获故障现场
  async captureCrashScene(task, logFile, reason) {
    try {
      // 记录 git diff
      const { stdout: diff } = await execAsync(
        `git diff --stat`,
        { cwd: task.worktree, timeout: 10000 }
      );
      
      const crashReport = `
========== 故障现场 ==========
时间: ${new Date().toISOString()}
任务ID: ${task.id}
终止原因: ${reason}
Git Diff:
${diff}
日志文件: ${logFile}
===============================
`;
      
      // 追加到日志文件
      await fs.appendFile(logFile, crashReport);
      
      // 同时保存到独立的故障报告
      const crashFile = path.join(
        this.logsDir,
        `crash_${task.id}_${Date.now()}.log`
      );
      await fs.writeFile(crashFile, crashReport);
      
    } catch (err) {
      this.logger.warn(`捕获故障现场失败: ${task.id}`, err);
    }
  }

  // 广播到UI
  broadcastToUI(event, data) {
    this.emit(event, data);
    // 如果有 WebSocket 服务，也可以在这里广播
    // this.wsService?.broadcast(event, data);
  }

  // 异步创建 worktree
  async createWorktree(agentId) {
    const worktreePath = path.join(this.workspaceRoot, '.worktrees', agentId);
    await this.forcePruneWorktree(agentId, worktreePath);

    try {
      await execAsync(
        `git worktree add "${worktreePath}" -b "agent-${agentId}"`,
        { cwd: this.workspaceRoot }
      );
    } catch (err) {
      this.logger.error(`创建 worktree 失败: ${agentId}`, err);
      throw new Error(`Git worktree allocation failed for agent: ${agentId}`);
    }

    return worktreePath;
  }

  // 强制清理特定 worktree
  async forcePruneWorktree(agentId, worktreePath) {
    try {
      if (existsSync(worktreePath)) {
        await execAsync(`git worktree remove "${worktreePath}" --force`, { cwd: this.workspaceRoot });
      }
      await execAsync(`git worktree prune`, { cwd: this.workspaceRoot });
    } catch (_) {}

    try {
      await execAsync(`git branch -D "agent-${agentId}"`, { cwd: this.workspaceRoot });
    } catch (_) {}
  }

  // 清理 worktree
  async cleanupWorktrees(tasks) {
    for (const task of tasks) {
      try {
        await this.forcePruneWorktree(task.id, task.worktree);
      } catch (err) {
        this.logger.warn(`清理 worktree 失败: ${task.id}`, err);
      }
    }
  }

  // 状态持久化（用户手动恢复）
  async saveOrchestrationState(agentId, status, error = null, taskConfig = null) {
    const state = {
      agentId,
      status,
      error,
      taskConfig, // 保存完整任务配置
      timestamp: new Date().toISOString(),
    };
    await this.stateStore.save(`agent:${agentId}`, state);
  }
}
```

### 4.2 工具集定义

```javascript
_buildTools(workingDir) {
  const tools = [];

  // Agent 工具
  tools.push({
    name: 'Agent',
    description: '启动子Agent执行任务',
    input_schema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '任务描述' },
        model: { type: 'string', enum: ['haiku', 'sonnet', 'opus'], description: '使用的模型' },
        run_in_background: { type: 'boolean', description: '是否后台运行' }
      },
      required: ['task']
    }
  });

  // 文件读取
  tools.push({
    name: 'read_file',
    description: '读取文件内容',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件路径' }
      },
      required: ['file_path']
    }
  });

  // 文件写入
  tools.push({
    name: 'write_to_file',
    description: '写入文件内容',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '文件内容' }
      },
      required: ['file_path', 'content']
    }
  });

  // 列出文件
  tools.push({
    name: 'list_files',
    description: '列出目录文件',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径' }
      }
    }
  });

  // 执行命令
  tools.push({
    name: 'execute_command',
    description: '执行shell命令',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '命令' }
      },
      required: ['command']
    }
  });

  return tools;
}
```

## 五、崩溃恢复策略

**采用用户手动恢复方式：**
- 服务器重启后，检测到running状态的工作流
- 标记为 `interrupted` 状态
- 用户在UI界面手动点击"继续执行"
- 系统从检查点恢复执行

## 六、并发控制

```javascript
const pLimit = require('p-limit');
const limit = pLimit(5); // 最大5个并行

const tasks = subTaskList.map(task =>
  limit(() => this.spawnAgent(task))
);
const results = await Promise.allSettled(tasks);
```

## 七、网络自愈

```javascript
const NETWORK_ERRORS = [
  'ENOTFOUND',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
];

// 网络错误延长重试间隔
if (isNetworkError) {
  delay = [5000, 15000, 30000][attempt - 1]; // 5s, 15s, 30s
}
```

## 八、故障日志留存

```javascript
// 日志目录
this.logsDir = path.join(workspaceRoot, 'logs');

// 日志文件命名
const logFile = path.join(this.logsDir, `run_${task.id}_${Date.now()}.log`);

// 故障现场捕获
async captureCrashScene(task, logFile, reason) {
  const { stdout: diff } = await execAsync(`git diff --stat`, { cwd: task.worktree });
  const crashReport = `
========== 故障现场 ==========
时间: ${new Date().toISOString()}
任务ID: ${task.id}
终止原因: ${reason}
Git Diff:
${diff}
===============================
`;
  await fs.appendFile(logFile, crashReport);
}
```

## 九、事件流机制

```javascript
// 事件定义
const AGENT_EVENTS = {
  STARTED: 'task_started',
  PROGRESS: 'task_progress',
  COMPLETED: 'task_completed',
  FAILED: 'task_failed',
};

// 事件监听
agentInstance.on('task_started', (data) => {
  this.broadcastToUI('agent:started', data);
});

agentInstance.on('task_progress', (data) => {
  this.broadcastToUI('agent:progress', data);
});

agentInstance.on('task_completed', (data) => {
  this.broadcastToUI('agent:completed', data);
});

agentInstance.on('task_failed', (data) => {
  this.broadcastToUI('agent:failed', data);
});
```

## 十、待实现清单

1. [ ] 修改 SdkService.js，将子Agent从CLI改为SDK模式
2. [ ] 创建 MasterAgentOrchestrator 类
3. [ ] 实现事件流机制
4. [ ] 实现Git worktree隔离
5. [ ] 实现故障日志留存
6. [ ] 实现网络自愈
7. [ ] 修改前端API，支持三个模型选择
8. [ ] 测试多工作流并发执行
9. [ ] 测试主子Agent生命周期管理
10. [ ] 测试崩溃恢复机制

---

**文档版本**: v1.0
**创建时间**: 2026-05-31
**最后更新**: 2026-05-31
