# Claude Workflow Studio — 架构文档

## 目录

1. [系统架构总览](#一系统架构总览)
2. [双引擎执行模型](#二双引擎执行模型)
3. [命名 Agent 工具机制](#三命名-agent-工具机制)
4. [工作流执行引擎](#四工作流执行引擎)
5. [检查点与断点续传](#五检查点与断点续传)
6. [审批与并行节点](#六审批与并行节点)
7. [前端-后端通信](#七前端-后端通信)
8. [数据库设计（概念）](#八数据库设计概念)
9. [工作区沙箱与安全](#九工作区沙箱与安全)
10. [技能注入流程](#十技能注入流程)
11. [记忆系统](#十一记忆系统)
12. [自我修复与容错](#十二自我修复与容错)
13. [数据持久化机制](#十三数据持久化机制)
14. [技术参数汇总](#十四技术参数汇总)

---

## 一、系统架构总览

### 整体架构图

```
+------------------------------------------+
|              Browser (SPA)                |
|  Dashboard | Agents | Workflows | Terminal|
+---------------------+--------------------+
                      |  HTTP + WebSocket
+---------------------+--------------------+
|         Express + WebSocket Server        |
|  Routes | Middleware | Auth | Rate Limit  |
|  WorkflowService | AgentService | Memory  |
|  sql.js (WASM SQLite) | JSON | Workspace |
+---------------------+--------------------+
                      |
+---------------------+--------------------+
|           Dual-Engine Execution           |
|                                           |
|  +--------------+    +----------------+  |
|  | Master (SDK) |-->| Sub Agent (CLI)|  |
|  | tool_use     |   | claude --print |  |
|  | Agent tools  |   | Full toolset   |  |
|  | Orchestrate  |   | Process isolate|  |
|  +--------------+    +----------------+  |
|                                           |
|  Fallback: CLI unavailable -> SDK mode    |
+------------------------------------------+
```

### 数据流方向

```
用户操作 → SPA 前端 → HTTP/WS → Express 路由 → Service 层
    → 主 Agent (SDK tool_use 循环)
        → 子 Agent 1 (claude --print CLI 进程)
        → 子 Agent 2 (claude --print CLI 进程)
        → ...
    → 检查点落盘 → 输出回传 → WebSocket 广播 → 前端渲染
```

---

## 二、双引擎执行模型

平台采用**双引擎架构**：SDK 主 Agent 编排 + CLI 子 Agent 执行。

### 2.1 主 Agent（SDK 引擎）

| 属性 | 说明 |
|------|------|
| 引擎 | Anthropic SDK（非 CLI） |
| 机制 | `tool_use` 循环 — 模型决定调用工具 → 执行工具 → 结果返回模型 → 下一轮 |
| 工具集 | 自定义命名 Agent 工具 (`Agent_n2`, `Agent_n3`, ...) + Bash + Read/Write 等 |
| API Key | 用户在设置页面配置，AES-256-GCM 加密存储 |
| 职责 | 解析工作流 DAG → 拓扑排序 → 按层分发子任务 → 汇总结果 |

### 2.2 子 Agent（CLI 引擎）

| 属性 | 说明 |
|------|------|
| 引擎 | `claude --print` CLI 进程 |
| 启动方式 | `child_process.spawn`，每个节点启动一个独立进程 |
| 模型 | 由工作流节点配置决定，代码强制指定（非 CLI 默认值） |
| 技能 | 由工作流节点配置决定，代码强制注入（非 CLI 配置文件） |
| 上下文 | 独立上下文窗口，不受其他子 Agent 影响 |
| 隔离 | 真实进程隔离（独立 PID、独立内存空间） |
| 工具集 | 完整工具集（Read、Write、Edit、Bash、Glob、Grep、WebSearch、WebFetch 等） |

### 2.3 回退机制

```
尝试启动 CLI 子进程
  ├── CLI 可用 → 正常 CLI 模式执行
  └── CLI 不可用（未安装/版本不兼容）
        → 自动回退到 SDK 模式
        → 使用 Anthropic SDK 直接调用
        → 功能等价，但失去进程隔离优势
```

### 2.4 模型别名系统

所有模型引用使用 CLI 别名，通过 ccswitch（`~/.claude/settings.json`）映射到实际模型：

| 别名 | 含义 | 典型场景 |
|------|------|---------|
| `opus` | 最强推理 | 复杂架构设计、多步骤推理 |
| `sonnet` | 平衡模型 | 日常编码、代码审查 |
| `haiku` | 快速轻量 | 简单任务、AI 工作流生成 |

别名更改后立即生效，无需重启服务。

---

## 三、命名 Agent 工具机制

### 3.1 工具生成

工作流执行时，主 Agent 的系统提示词中动态注入命名 Agent 工具：

```
工具名称规则: Agent_n2, Agent_n3, Agent_n4, ...
（n + 节点索引，从 2 开始）
```

每个 `Agent_nX` 工具的定义包含：
- **name**: `Agent_nX`
- **description**: 该节点的工作描述（从节点配置生成）
- **input_schema**: 接受上游输出作为输入

### 3.2 工具调用流程

```
主 Agent 收到工具调用决议
  → 识别被调用的 Agent_nX 工具
  → 根据工具名查表获取对应的工作流节点配置
  → spawn claude --print 子进程
  → 子进程配置 = 节点模型 + 节点技能 + 节点系统提示词
  → 将上游输出作为用户提示传入
  → 等待子进程完成（stdout 流式输出）
  → 将输出作为 tool_result 返回给主 Agent
  → 主 Agent 继续下一轮 tool_use 循环
```

### 3.3 优势

- **上下文隔离**：每个子 Agent 拥有独立上下文窗口，不会因为累积而超出限制
- **配置独立**：不同节点可使用不同的模型、技能、系统提示词
- **进程隔离**：一个子 Agent 崩溃不会影响其他子 Agent 或主流程
- **安全沙箱**：每个子进程独立受限在工作区目录内

---

## 四、工作流执行引擎

### 4.1 执行入口

```
WorkflowService.execute(workflowId, input, options)
```

### 4.2 执行阶段

**阶段一：准备**

1. 从数据库读取工作流定义（nodes + edges）
2. 验证 DAG 完整性（必须有 start 节点）
3. 检查是否已在运行中（防重复执行）
4. 分配工作区路径
5. 生成唯一 runId
6. 初始化节点状态（全部 pending）
7. 记忆追加式写入（不归档，append-only + 自动压缩）

**阶段二：拓扑排序**

1. 构建邻接表和 indegree 数组
2. BFS 分层 — 同一层节点 indegree=0 时可并行
3. 生成层级执行计划

**阶段三：构建主 Agent 系统提示词**

```
系统提示词 = [
  基础角色指令,
  工作流 DAG 描述,
  命名 Agent 工具列表 (Agent_n2, Agent_n3, ...),
  执行规则（按层串行，层内并行）,
  检查点规则（每个节点完成后保存）,
  memory injection（已保存的工作流记忆）,
  knowledge injection（手动选择的知识库条目）,
  skill injection（已安装技能的系统提示词）
]
```

**阶段四：SDK tool_use 循环**

```
while 工作流未完成:
    response = await sdk.messages.create({
      model: 主 Agent 模型,
      system: 系统提示词,
      messages: 对话历史,
      tools: [Agent_n2, Agent_n3, ...]
    })

    if response.stop_reason === 'tool_use':
      for each tool_call in response:
        执行工具（spawn CLI 子进程 / Bash / Read 等）
        将 tool_result 加入对话历史
    else:
      工作流完成，提取最终输出
```

**阶段五：完成处理**

1. 更新工作流状态为 completed
2. 广播 WebSocket 完成事件
3. 生成执行报告
4. 保存最终检查点

### 4.3 节点类型执行逻辑

| 节点 | 执行逻辑 |
|------|---------|
| **start** | 透传用户输入给下游 |
| **agent** | 主 Agent 通过 SDK tool_use 循环调用，按节点配置的模型/技能/提示词执行 |
| **parallel** | 单次 SDK 消息中原子派发多个 Agent，并发执行 |
| **approval** | 暂停执行 → WebSocket 通知前端 → 等待用户操作 → resolve/reject |
| **merge** | 收集直接上游输出，用 `---` 分隔合并 |
| **subworkflow** | 递归调用另一个工作流，记忆回传父工作流 |
| **end** | 汇总上游输出，生成最终结果 |

---

## 五、检查点与断点续传

### 5.1 检查点存储

每个工作流节点执行完成后，立即写入检查点文件：

```
workspace/<wsId>/.checkpoint/
├── <runId>_<nodeIndex>.json    # 每个节点一个检查点文件
└── <runId>_state.json          # 全局执行状态
```

检查点内容：
- 节点输出（供下游节点使用）
- 节点状态（completed / failed / skipped）
- 时间戳
- 使用的模型和技能信息

### 5.2 写入策略

- **同步写入**：`fs.writeFileSync` 确保崩溃前数据已落盘
- **失败前保存**：即使执行失败，也在抛出错误前保存当前检查点
- **原子写入**：先写临时文件，再 rename 到最终位置

### 5.3 断点恢复

```
服务器启动
  → 扫描 workspace/.checkpoint/
  → 发现未完成的 runId
  → 标记工作流状态为 interrupted
  → 前端显示「续传」按钮
  → 用户点击续传
  → 加载已完成的检查点 → 跳过已完成节点
  → 从第一个 pending 节点继续执行
  → 自动注入已保存的工作流记忆
```

### 5.4 暂停与恢复

| 特性 | 实现 |
|------|------|
| 暂停触发 | 前端发送暂停信号 → WebSocket → abortSignal |
| 暂停延迟 | < 5 秒（当前节点执行完后立即停止） |
| 恢复方式 | 使用检查点，从断点继续 |
| 超时等待 | 暂停状态最多保持 30 分钟，超时自动终止 |

---

## 六、审批与并行节点

### 6.1 审批节点

审批节点是**真实的 WebSocket 往返**：

```
执行到达审批节点
  → 节点状态设为 waiting_approval
  → WebSocket 广播 humanIntervention 事件（携带节点输出）
  → 前端弹出审批弹窗（显示 Agent 输出 + 通过/拒绝按钮）
  → 后端创建 Promise，等待用户操作
  → 超时保护：5 分钟无操作自动拒绝

用户操作：
  ├── 通过 → Promise resolve → 节点标记 completed → 继续下游
  └── 拒绝 → Promise reject → 节点标记 failed → 可根据配置跳过
```

### 6.2 并行节点

并行节点在同一轮 tool_use 中**原子派发多个子 Agent**：

```
执行到达并行节点
  → 主 Agent 在单次 SDK 消息中调用多个 Agent_nX 工具
  → 所有子 Agent 同时 spawn（独立的 CLI 进程）
  → Promise.allSettled 等待全部完成
  → 一个子 Agent 失败不影响其他子 Agent
  → 全部完成后，合并输出传往下游
```

关键实现：
- 主 Agent 的系统提示词要求一次性发出所有并行工具调用
- 后端收到多个 tool_use 后并发 spawn CLI 进程
- 使用 Promise.allSettled 而非 Promise.all 确保容错

---

## 七、前端-后端通信

### 7.1 通信通道

```
┌─────────────────────────────────┐
│           前端 SPA               │
│                                  │
│  HTTP REST (fetch)  ──────────►  Express 路由
│  WebSocket (ws)     ◄──────────►  WS Server
│  Server-Sent Events  (流式输出)  │
└─────────────────────────────────┘
```

### 7.2 HTTP REST API

统一响应格式：

```json
{
  "success": true,
  "data": { ... },
  "meta": { "total": 100, "page": 1, "limit": 20 }
}
```

主要 API 端点：

| 模块 | 端点 | 功能 |
|------|------|------|
| Agents | `/api/agents` | CRUD + 批量删除 |
| Workflows | `/api/workflows` | CRUD + 执行 + 快照 + AI 创建 + 流程图导入 + 批量克隆 |
| Tasks | `/api/tasks` | CRUD + 批量删除 |
| Task Queues | `/api/task-queues` | 队列管理 + 批量执行 |
| Files | `/api/files` | 浏览 + 读写 + 工作区切换 |
| Knowledge | `/api/knowledge` | CRUD + 搜索 + 导入导出 |
| Memory | `/api/memory` | 读写 + 搜索 + 共享池 |
| Chat | `/api/chat` | 会话管理 |
| Terminal | `/api/terminal` | PTY 会话管理 |
| Skills | `/api/skills` | 安装 + 卸载 + 市场列表 |
| MCP | `/api/mcp-tools` | MCP 工具管理 |
| Auth | `/api/auth/key` | API Key 获取 |
| Health | `/api/health` | 服务状态 + CLI 兼容性 |

### 7.3 WebSocket 频道

| 频道 | 方向 | 说明 |
|------|------|------|
| `claude.stream` | 后端→前端 | CLI 子进程 stdout 流式输出 |
| `workflow.statusUpdate` | 后端→前端 | 工作流整体状态变化 |
| `workflow.nodeUpdate` | 后端→前端 | 单节点状态更新（含实时输出） |
| `workflow.humanIntervention` | 后端→前端 | 审批节点等待人工操作 |
| `task.*` | 后端→前端 | 任务状态变化 |
| `queue.*` | 后端→前端 | 队列事件（启动/暂停/完成等） |
| `agent.*` | 后端→前端 | Agent 增删改和状态变化 |
| `client.count` | 后端→前端 | 在线客户端数量 |

### 7.4 流式输出处理

```
CLI 子进程 stdout
  → 后端逐行解析 stream-json
  → WebSocket 广播到所有客户端
  → 前端追加到对应节点的实时输出面板
  → 显示最近 200 个字符
  → isComplete = true → 面板淡出
```

### 7.5 WebSocket 重连

- 指数退避：1s → 1.5s → 2.25s → ... → 30s（最大）
- 最多 10 次重试
- 重连成功后自动触发 `ws:reconnected` 事件
- 各页面组件监听该事件，重新加载最新数据
- 心跳间隔：客户端 25 秒 ping，服务端 30 秒超时

---

## 八、数据库设计（概念）

平台使用 **sql.js（纯 WASM SQLite）** 作为持久化存储，零原生依赖。

### 8.1 存储位置

```
data/
├── workflows.sqlite          # 工作流 SQLite 数据库
├── prompt-templates.sqlite   # 提示词模板 SQLite 数据库
├── api-key.json              # API Key（AES-256-GCM 加密存储）
├── active-workspaces.json    # 已注册工作区列表
├── current-workspace.json    # 当前活跃工作区路径
├── workspace-history.json    # 工作区使用历史
├── audit-logs.json           # 审计日志（最近 1000 条）
├── skills/                   # 已安装技能状态
├── mcp/                      # MCP 工具配置
└── chat-workspace/           # 对话隔离工作区

workspace/<wsId>/
├── .checkpoint/              # 检查点文件（节点级）
├── .context/                 # 工作流记忆
│   ├── {workflow-id}.md
│   └── shared/
│       └── pool.json
├── reports/                  # 执行报告
└── WORKFLOWS/                # 工作流、技能等配置
├── workflows.json            # 工作流定义
├── knowledge.json            # 知识库数据
├── tags.json                 # 标签
├── artifact-index.json       # 成果索引
├── chat-sessions.json        # 对话会话
├── prompt-templates.json     # 提示词模板
├── skills.json               # 已安装技能
├── mcp-tools.json            # MCP 工具列表
├── execution-log.json        # 执行历史
└── snapshots/                # 快照目录
```

### 8.2 核心数据模型（概念）

**Workflow（工作流）**
```
id, name, description, workspaceId,
nodes: [{ id, type, config, position }],
edges: [{ source, target }],
status: draft | running | completed | failed | interrupted,
createdAt, updatedAt
```

**Agent（智能体）**
```
id, name, model (opus|sonnet|haiku), role,
systemPrompt, temperature, toolPermissions,
scope: workspace | global,
status: idle | busy
```

**Task（任务）**
```
id, name, workflowId, agentId, workspaceId,
input, priority, status: pending | running | completed | failed,
checkpointFiles, createdAt, completedAt
```

**ExecutionLog（执行记录）**
```
runId, workflowId, status,
nodeResults: [{ nodeId, status, output, startedAt, completedAt }],
startedAt, completedAt
```

**Memory（记忆）**
```
workflowId, sessions: [{ timestamp, task, summary, files, notes }],
sharedPool: { variables, notes, recentOutputs }
```

---

## 九、工作区沙箱与安全

### 9.1 多层安全防护

```
┌─────────────────────────────────────────┐
│ 第一层：API 鉴权                         │
│  - API Key 自动生成 + AES-256-GCM 加密   │
│  - HTTP: X-API-Key 头                    │
│  - WebSocket: ?api_key= 查询参数          │
├─────────────────────────────────────────┤
│ 第二层：三层限流                         │
│  - 全局: 600 次/分钟                     │
│  - 写操作: 200 次/10 秒                  │
│  - 鉴权: 10 次/分钟                      │
├─────────────────────────────────────────┤
│ 第三层：工作区沙箱                       │
│  - --permission-mode acceptEdits         │
│  - 系统提示词限工作区内写入              │
│  - WORKFLOWS 目录保护（禁止读写配置）    │
│  - 执行后检测并搬回越界文件              │
├─────────────────────────────────────────┤
│ 第四层：路径穿越防护                     │
│  - resolvePath 校验所有文件路径          │
│  - 拒绝 ../ 穿越到工作区外的请求         │
├─────────────────────────────────────────┤
│ 第五层：Agent 内存沙箱                   │
│  - 每 10 秒监测 RSS                     │
│  - 超过 2GB 自动 kill 进程               │
│  - 30 分钟执行超时                       │
└─────────────────────────────────────────┘
```

### 9.2 API Key 管理

- 支持多配置 API Key，用户可在设置页面管理多个 Key
- 所有 Key 使用 AES-256-GCM 加密存储
- 前端通过 `/api/auth/key` 自动获取 Key
- 导出备份时自动排除 `api-key.json`
- 首次启动自动生成随机 API Key

---

## 十、技能注入流程

### 10.1 技能来源

| 来源 | 数量 | 说明 |
|------|------|------|
| Anthropic 官方技能 | 来自 anthropics/skills | 官方维护的技能集合 |
| ECC 社区技能 | 来自 affaan-m/ECC | 第三方精选技能 |
| 市场总计 | **249 个** | 覆盖 19 个分类 |

### 10.2 注入流程

```
Agent 节点准备执行
  → 查询该 Agent 已安装的技能列表
  → 从 skills/ 目录加载每个技能的提示词
  → 从 mcp/ 目录加载 MCP 工具配置
  → 拼接到子 Agent 的系统提示词中
  → 系统提示词 = [基础指令] + [技能提示词 1] + [技能提示词 2] + ... + [MCP 工具]
  → spawn claude --print --system-prompt <完整提示词>
```

### 10.3 安装与卸载

- 安装记录持久化到 `skills/` 目录
- 支持安装到单个 Agent 或所有 Agent
- 卸载时移除配对关系，不会删除技能文件
- 页面刷新后安装状态不丢失

---

## 十一、记忆系统

### 11.1 存储结构

```
workspace/<wsId>/.context/
├── <workflow-id>.md           # 工作流记忆（Markdown 格式）
├── <workflow-id>.md.bak       # 归档备份
└── shared/
    └── pool.json              # 共享数据池
```

### 11.2 记忆写入

工作流执行完成后，系统自动从输出中提取：

1. **输出摘要**：过滤噪音，提取有意义的核心内容
2. **Agent 主动记忆**：提取输出中的 `[记忆: xxx]` 或 `[Memory: xxx]` 标记
3. **任务标签**：使用任务输入的前 50 字符作为标签

记忆格式：`## Session {时间戳} | {任务标签}`，支持按任务关键词过滤。

去重检查：若与上次记录的 70% 以上行相同，跳过写入。
自动压缩：总长度超过 15000 字符时，保留最近 5 次完整记录，更早的只保留标题。

### 11.3 记忆注入

子 Agent 执行前，记忆按任务关键词过滤后注入到系统提示词中：

```
当前工作流记忆（按任务关键词过滤，最多 10000 字符）
+ 最多 5 个来源 跨工作流记忆（每个最多 5000 字符）
+ 最多 3000 字符 共享数据池
```

关键词过滤：从任务输入中提取中文 bigram 和英文单词，排除常见后缀（笔记、任务、工作等），只注入匹配的记忆条目。

### 11.4 跨工作流记忆传递

- 子工作流执行完成后，记忆摘要回传到父工作流
- 共享池数据合并到父工作流的共享池
- 配置 memorySource 可指定从特定工作流继承记忆

### 11.5 Claude Code Workflows 互操作

平台支持与 Claude Code 的 `.md` 格式工作流文件双向互操作：

**导入（.md → 可视化）：**
- 解析 frontmatter 中的 `description`、`model` 等元数据
- 解析 `## 步骤 N：xxx` 格式的步骤列表
- 每个步骤映射为一个 Agent 节点，自动连线生成 DAG
- 在可视化编辑器中展开，用户可手动调整

**导出（可视化 → .md）：**
- 拓扑排序工作流节点
- Agent 节点转为 `## 步骤 N：xxx` 格式
- 保留节点的 systemPrompt 和 model 配置
- 生成标准 `.md` 文件，可直接放入 `.claude/workflows/` 使用

---

## 十二、自我修复与容错

### 12.1 错误分类（9 种）

| 错误类型 | 识别 | 重试策略 | 自动修复 |
|---------|------|---------|---------|
| TOKEN_EXHAUSTED | token + limit/exceed | 30s→60s→120s | 切换备选模型 |
| RATE_LIMITED | rate_limit | 5s→15s→45s | 指数退避 |
| SERVICE_OVERLOADED | overloaded | 10s→30s→90s | 切换备选模型 |
| CONTEXT_TOO_LONG | context + length | 标准退避 | 自动截断 70% |
| TIMEOUT | 超时 30min | 标准退避 | 保存检查点 |
| EXECUTION_ERROR | 未知 | 最多 2 次 | 无 |
| AUTH_ERROR | unauthorized | 不重试 | 提示用户 |
| BILLING_ERROR | billing | 不重试 | 提示用户 |
| CLI_NOT_FOUND | ENOENT | 不重试 | 回退 SDK 模式 |

### 12.2 断路器

```
5 次连续失败 → 熔断 30 秒 → 半开试探 2 次
  ├── 成功 → 恢复正常
  └── 失败 → 重新熔断
```

### 12.3 模型降级链

```
Opus → Sonnet → Haiku
未知模型 → Haiku（兜底）
```

---

## 十三、数据持久化机制

### 13.1 三层防护

| 层级 | 机制 |
|------|------|
| 运行时 | setImmediate 防抖 + 同步路径 (writeFileSync) 即时落盘 |
| 周期性 | 每 2 秒自动 Flush 所有 6 个数据模型 |
| 关闭/崩溃 | SIGTERM→7 服务 flush→exit / uncaughtException→flush→exit(1) |

### 13.2 数据迁移

- 首次访问 sql.js 时自动从 JSON 文件迁移
- 迁移后 JSON 文件保留作为备份
- SQLite 损坏时从 `.migrated` 备份恢复

### 13.3 工作区恢复

- 服务器重启从 `current-workspace.json` 恢复活跃工作区
- `clear() + reload()` 完全替换为工作区数据，消除旧数据残留
- `resetStuckNodes()` 扫描 running 节点并标记 interrupted

---

## 十四、技术参数汇总

| 参数 | 值 |
|------|-----|
| Web 服务器端口 | 3000 |
| WebSocket 心跳 | 客户端 25 秒 / 服务端 30 秒超时 |
| 断线重连 | 最多 10 次，最长 30 秒间隔 |
| Agent 执行超时 | 30 分钟 |
| 子 Agent 内存上限 | 2GB RSS |
| 内存监测间隔 | 10 秒 |
| 列表分页 | 20 条/页 |
| 记忆压缩阈值 | 15000 字符 |
| 知识注入上限 | 8000 字符 |
| 共享池注入上限 | 3000 字符 |
| 跨工作流记忆上限 | 5 个源 / 每个 5000 字符 |
| 审批/输入超时 | 5 分钟 |
| 自动 Flush | 2 秒间隔 |
| 终端会话上限 | 10 个 |
| 断路器冷却 | 30 秒 |
| 数据备份 | GET export ZIP / POST import |
| 日志轮转 | 每日，30 天清理 |
| API Key 加密 | AES-256-GCM |
| 持久化引擎 | sql.js (WASM SQLite) |

---

## 十五、功能模块

侧边栏分为 4 个分组，共 16 个页面：

### 核心

| 模块 | 说明 |
|------|------|
| **控制面板** | 仪表盘：CPU/内存实时采样、智能体数量、活跃工作流、待处理任务、对话/终端会话数（5 张 SVG 图标统计卡片）。支持深浅主题切换 |
| **智能体** | 创建和管理 AI Agent，配置模型（opus/sonnet/haiku 别名）、系统提示词、温度、工具权限、角色预设 |
| **工作流** | 可视化拖拽编排，支持 7 种节点类型、AI 创建、批量克隆、流程图导入/导出、记忆传递、知识注入 |
| **文件** | 工作区文件树浏览、文件预览/编辑、新建文件/文件夹、工作区管理 |
| **任务** | 创建/执行/管理任务，关联工作流，任务队列批量执行，实时状态更新 |

### 工具

| 模块 | 说明 |
|------|------|
| **终端** | xterm.js 终端模拟器，多会话管理（上限 10 个），PTY 真实终端 |
| **对话** | AI 多轮对话，支持模型切换、系统提示配置、会话搜索，默认 Haiku |

### 数据

| 模块 | 说明 |
|------|------|
| **成果库** | 自动索引工作区内生成文件，实时监听变化，支持搜索、预览、删除 |
| **知识库** | 个人知识管理，按分类/标签组织，全文搜索，导入/导出（JSON/CSV/Markdown） |
| **记忆** | 任务标签记忆、关键词过滤注入、跨工作流传递、共享数据池、自动压缩 |
| **数据分析** | 执行统计、按工作流统计、执行时间线视图 |
| **历史** | 所有工作流执行历史，查看详情/报告、批量删除 |
| **报告** | 执行报告查看和管理 |

### 系统

| 模块 | 说明 |
|------|------|
| **市场** | 技能市场（249 个技能，19 个分类）+ 工作流模板（19 个内置） |
| **广播** | 事件广播和通知管理 |
| **设置** | 系统配置、偏好设置、审计日志、提示词模板、API Key 管理 |

---

## 十六、智能体配置

| 配置项 | 说明 |
|--------|------|
| 模型 | opus（最强推理）/ sonnet（平衡）/ haiku（快速轻量） |
| 系统提示词 | 定义 Agent 行为方式 |
| 温度 | 控制输出随机性（0-1） |
| 工具权限 | 读文件、写文件、执行命令等 |
| 角色预设 | 开发者、审查员、测试员、规划师、调试员、文档员、自定义 |

---

## 十七、工作区管理

每个工作区是独立的运行环境：

```
workspace/<wsId>/
├── WORKFLOWS/          # 工作流、技能等配置
│   ├── workflows.json
│   ├── knowledge.json
│   ├── tags.json
│   ├── artifact-index.json
│   ├── chat-sessions.json
│   ├── prompt-templates.json
│   ├── skills.json
│   ├── mcp-tools.json
│   ├── execution-log.json
│   ├── .checkpoint/    # 每步检查点文件
│   └── snapshots/      # 快照
├── reports/            # 执行报告
├── .context/           # 工作流记忆
│   ├── {workflow-id}.md
│   └── shared/
│       └── pool.json
└── .BACKUP/            # 自动备份（崩溃恢复用）
```

---

## 十八、数据存储

### `data/` 目录（全局数据）

| 文件 | 说明 |
|------|------|
| `agents.json` | 智能体配置 |
| `tasks.json` | 全局任务数据 |
| `task-queues.json` | 全局任务队列 |
| `chat-sessions.json` | 对话会话 |
| `prompt-templates.json` | 提示词模板 |
| `audit-logs.json` | 操作审计日志（最近 1000 条） |
| `api-key.json` | API Key（AES-256-GCM 加密存储） |
| `active-workspaces.json` | 已注册工作区列表 |
| `current-workspace.json` | 当前活跃工作区路径 |
| `workspace-history.json` | 工作区使用历史 |
| `skills/` | 已安装技能状态 |
| `mcp/` | MCP 工具配置 |

---

## 十九、安全与鉴权

- **API Key 鉴权**：首次启动自动生成，AES-256-GCM 加密存储
- **三层限流**：全局 600 次/分钟、写操作 200 次/10 秒、鉴权 10 次/分钟
- **工作区沙箱**：`--permission-mode acceptEdits` 限制工作区内写入
- **路径穿越防护**：所有文件路径通过 resolvePath 校验
- **Agent 内存沙箱**：每 10 秒监测 RSS，超过 2GB 自动终止进程
- **工具白名单**：Edit/Write（限工作区）、Read、Bash（仅读命令）、WebSearch/Fetch、Agent、Glob/Grep
- **日志持久化**：`logs/app-YYYY-MM-DD.log` 每日轮转，自动清理 30 天前日志

---

## 二十、错误分类与自适应重试

| 错误类型 | 退避策略 | 自动修复 | 制止机制 |
|---------|---------|---------|---------|
| Token 耗尽 | 30s → 60s → 120s | 切换备用模型 | 降级模型也失败→放弃 |
| 频率超限 | 5s → 15s → 45s | 指数退避等待 | 3次同类→放弃 |
| 服务过载 | 10s → 30s → 90s | 切换备用模型 | 降级模型也失败→放弃 |
| 上下文超长 | 标准退避 | 自动截断输入至70% | 3次同类→放弃 |
| 认证失败 | 不重试 | 提示修复 API Key | 立即停止 |
| 余额不足 | 不重试 | 提示充值 | 立即停止 |
| CLI 未安装 | 不重试 | 回退 SDK 模式 | 立即停止 |
| 未知错误 | 不重试（最多2次） | — | 2次同类→放弃 |
| 超时 | 标准退避 | 保存检查点 | 3次同类→放弃 |

- **断路器**：5次连续失败→熔断30秒→半开试探→恢复或重熔断
- **模型降级链**：opus → sonnet → haiku，未知模型 → haiku（兜底）

---

## 二十一、性能优化

| 优化项 | 说明 |
|--------|------|
| 分页懒加载 | 列表默认加载 20 条，点击"加载更多"获取下一页 |
| WebSocket 自动重连 | 指数退避（最大 30 秒），最多 10 次 |
| 客户端缓存 | `Cache` 工具类，支持 TTL（默认 5 分钟） |
| 消息节流 | 仪表盘 2 秒，任务/Agent 列表 500 毫秒 |
| CPU 实时采样 | 两次采样（500ms 间隔）计算真实使用率 |
| 异步持久化 | 写入队列串行化，不阻塞事件循环 |
| 字体自适应 | 视口对角线连续缩放，60ms debounce，70%~100% 范围 |

---

## 二十二、API 概览

统一响应格式：
```json
{ "success": true, "data": { ... }, "meta": { "total": 100, "page": 1, "limit": 20 } }
```

| 模块 | 端点 | 说明 |
|------|------|------|
| 智能体 | `/api/agents` | CRUD + 批量删除 |
| 智能体模板 | `/api/agent-templates` | 预设角色模板 |
| 工作流 | `/api/workflows` | CRUD + 执行 + 快照 + AI创建 + 导入/导出 + 批量克隆 |
| 工作流模板 | `/api/workflow-templates` | 内置工作流模板 |
| 任务 | `/api/tasks` | CRUD + 批量删除 |
| 任务队列 | `/api/task-queues` | 批量任务队列管理 |
| 文件 | `/api/files` | 浏览 + 读写 + 工作区切换 |
| 知识库 | `/api/knowledge` | CRUD + 搜索 + 标签 + 导入/导出 |
| 记忆 | `/api/memory` | 读写 + 搜索 + 共享池 |
| 成果 | `/api/artifacts` | 索引 + 搜索 + 预览 + 删除 |
| 对话 | `/api/chat` | 会话管理 + 搜索 |
| 终端 | `/api/terminal` | 终端会话 + 历史 + 恢复 |
| 技能 | `/api/skills` | 安装 + 卸载 + 市场列表 |
| 历史 | `/api/history` | 执行历史 + 批量删除 |
| MCP | `/api/mcp-tools` | MCP 工具管理 |
| 提示词 | `/api/prompt-templates` | 提示词模板 CRUD |
| 工作区 | `/api/workspaces` | 工作区 CRUD + 切换 |
| 广播 | `/api/broadcast` | 事件广播 |
| 客户端 | `/api/clients` | 在线客户端管理 |
| 审计日志 | `/api/audit-logs` | 操作审计查询 |
| 告警 | `/api/alerts` | 告警管理 |
| 安全 | `/api/safety` | 安全审计 |
| 报告 | `/api/reports` | 执行报告 |
| Git | `/api/git` | Git 操作 |
| 资源 | `/api/resources` | 系统资源监控 |
| API Key | `/api/keys` | API Key 管理 |
| 健康 | `/api/health` | 服务状态 + CLI 兼容性 |

---

## 二十三、批处理脚本

| 脚本 | 说明 |
|------|------|
| `install.bat` | 一键安装依赖 |
| `install-global.bat` | 全局安装（可选） |
| `start.bat` | 启动服务 |
| `stop.bat` | 停止服务 |
| `restart.bat` | 重启服务 |
| `logs.bat` | 查看日志 |
| `add-to-startup.bat` | 添加开机自启 |
| `remove-from-startup.bat` | 取消开机自启 |

---

*文档基于 git master 分支最新提交*
