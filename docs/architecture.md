# Claude Workflow Studio — 架构文档

## 目录

1. [系统架构总览](#一系统架构总览)
2. [Claude Agent SDK 集成](#二claude-agent-sdk-集成)
3. [TS 强状态机驱动执行](#三ts-强状态机驱动执行)
4. [命名 Agent 工具机制](#四命名-agent-工具机制)
5. [工作流执行引擎](#五工作流执行引擎)
6. [检查点与断点续传](#六检查点与断点续传)
7. [审批与并行节点](#七审批与并行节点)
8. [前端-后端通信](#八前端-后端通信)
9. [数据库设计（概念）](#九数据库设计概念)
10. [工作区沙箱与安全](#十工作区沙箱与安全)
11. [技能注入流程](#十一技能注入流程)
12. [记忆系统](#十二记忆系统)
13. [自我修复与容错](#十三自我修复与容错)
14. [数据持久化机制](#十四数据持久化机制)
15. [技术参数汇总](#十五技术参数汇总)
16. [功能模块](#十六功能模块)
17. [智能体配置](#十七智能体配置)
18. [工作区管理](#十八工作区管理)
19. [数据存储](#十九数据存储)
20. [安全与鉴权](#二十安全与鉴权)
21. [错误分类与自适应重试](#二十一错误分类与自适应重试)
22. [性能优化](#二十二性能优化)
23. [API 概览](#二十三api-概览)
24. [批处理脚本](#二十四批处理脚本)
25. [Claude Agent SDK 深度集成](#二十五claude-agent-sdk-深度集成)
26. [双轨闭环架构](#二十六双轨闭环架构)
27. [数据分析与统计系统](#二十七数据分析与统计系统)
28. [任务优先级系统](#二十八任务优先级系统)
29. [工作区工作流统计](#二十九工作区工作流统计)
30. [系统资源监控](#三十系统资源监控)

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
|       TS State Machine Execution          |
|                                           |
|  +------------------+                    |
|  | WorkflowService  |                    |
|  | (State Machine)  |                    |
|  +--------+---------+                    |
|           |                               |
|  +--------v---------+                    |
|  |   SdkService     |                    |
|  | (query() calls)  |                    |
|  +--------+---------+                    |
|           |                               |
|  +--------v---------+                    |
|  | Claude Agent SDK |                    |
|  | (Subprocess)     |                    |
|  +------------------+                    |
|                                           |
+------------------------------------------+
```

### 数据流方向

```
用户操作 → SPA 前端 → HTTP/WS → Express 路由 → Service 层
    → TS 状态机 (WorkflowService._executeWorkflowStateMachine)
        → 子 Agent 1 (query() → Claude Agent SDK 子进程)
        → 子 Agent 2 (query() → Claude Agent SDK 子进程)
        → ...
    → 检查点落盘 → 输出回传 → WebSocket 广播 → 前端渲染
```

---

## 二、Claude Agent SDK 集成

平台采用 **Claude Agent SDK** 作为唯一执行引擎，通过 `query()` 函数启动独立子进程。

### 2.1 SDK 核心调用

| 属性 | 说明 |
|------|------|
| 引擎 | `@anthropic-ai/claude-agent-sdk` |
| 核心函数 | `query({ prompt, options })` |
| 子进程 | 每次调用启动独立的 `claude` 子进程 |
| 工具集 | 内置工具（Read、Write、Edit、Bash、Glob、Grep） |
| API Key | 用户在设置页面配置，AES-256-GCM 加密存储 |

### 2.2 模型别名系统

所有模型引用使用别名，通过 `ApiKeyService.resolveModel()` 映射到实际模型：

| 别名 | 含义 | 典型场景 |
|------|------|---------|
| `opus` | 最强推理 | 复杂架构设计、多步骤推理 |
| `sonnet` | 平衡模型 | 日常编码、代码审查 |
| `haiku` | 快速轻量 | 简单任务、AI 工作流生成 |

别名更改后立即生效，无需重启服务。

### 2.3 Agent 类型映射

Claude Agent SDK 支持的 Agent 类型：

| SDK类型 | 权限 | 用途 |
|---------|------|------|
| `Explore` | 只读 | 搜索、分析（不能创建文件） |
| `general-purpose` | 完整 | 开发、测试、文档（可创建文件） |

系统提示词自动推断逻辑：
- 搜索/分析类任务 → `Explore`
- 开发/测试/文档类任务 → `general-purpose`
- 默认 → `general-purpose`

---

## 三、TS 强状态机驱动执行

**核心原则：** "脑子归 AI，手脚归代码" — TypeScript 代码直接控制工作流执行，主Agent无法"假装运行"子Agent。

### 3.1 执行架构

```
┌─────────────────────────────────────────────────────────────┐
│                    执行架构                                   │
├─────────────────────────────────────────────────────────────┤
│ TS代码 (WorkflowService)                                     │
│    ↓                                                         │
│ 拓扑排序 → 确定执行顺序                                      │
│    ↓                                                         │
│ 直接调用 query() → 物理启动子进程                            │
│    ↓                                                         │
│ 子Agent执行 → 返回结果                                       │
│    ↓                                                         │
│ TS代码处理结果 → 传递给下一个节点                            │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 执行流程

1. **解析工作流 DAG** — 读取节点和边
2. **拓扑排序** — 确定执行顺序
3. **按顺序执行** — 直接调用 `query()` 执行每个节点
4. **并行执行** — 使用 `Promise.all` 同时执行多个节点
5. **条件判断** — 使用轻量级 AI 评估条件
6. **审批节点** — 通过 `Promise` 挂起等待人工确认

### 3.3 关键代码

```typescript
// WorkflowService._executeWorkflowStateMachine()
for (const nodeId of topoOrder) {
  const node = nodeMap.get(nodeId);

  switch (node.type) {
    case 'agent':
      // 直接调用 query() 启动子Agent
      nodeOutput = await sdkService._executeWithClaudeSdk(...);
      break;

    case 'condition':
      // 使用轻量级AI判断条件
      evalResult = sdkService._parseJsonSafely(evalRaw);
      break;

    case 'approval':
      // 挂起等待人工审批
      approvalResult = await new Promise((resolve) => { ... });
      break;
  }

  // 存储结果，传递给下一个节点
  nodeResults.set(nodeId, nodeOutput);
}
```

---

## 四、命名 Agent 工具机制

### 4.1 工具生成

工作流执行时，主 Agent 的系统提示词中动态注入命名 Agent 工具：

```
工具名称规则: Agent_n2, Agent_n3, Agent_n4, ...
（n + 节点索引，从 2 开始）
```

每个 `Agent_nX` 工具的定义包含：
- **name**: `Agent_nX`
- **description**: 该节点的工作描述（从节点配置生成）
- **input_schema**: 接受上游输出作为输入
- **agentType**: 子 Agent 类型（Explore/general-purpose）

**Agent 类型映射（Claude Agent SDK）：**

| SDK类型 | 权限 | 用途 |
|---------|------|------|
| `Explore` | 只读 | 搜索、分析（不能创建文件） |
| `general-purpose` | 完整 | 开发、测试、文档（可创建文件） |

系统提示词自动推断逻辑：
- 搜索/分析类任务 → `Explore`
- 开发/测试/文档类任务 → `general-purpose`
- 默认 → `general-purpose`

### 4.2 工具调用流程

```
TS 状态机直接调用 query()
  → 根据节点配置确定 agentType
  → 继承父 Agent 的系统提示 + 子 Agent 类型的系统提示
  → 启动 Claude Agent SDK 子进程
  → 子进程配置 = 节点模型 + 节点技能 + 节点系统提示词 + 派生权限
  → 将上游输出作为用户提示传入
  → 等待子进程完成（流式输出）
  → 将输出作为 tool_result 返回给主 Agent
  → 主 Agent 继续下一轮 tool_use 循环
```

### 3.3 Subagent 类型系统

简化为两种 SDK 原生类型：

| 类型 | 名称 | 权限 | 适用场景 |
|------|------|------|---------|
| `explore` | 探索 Agent | 只读 | 搜索代码、查找文件、分析代码结构 |
| `build` | 构建 Agent | 完整 | 编写代码、修改文件、执行构建任务 |
| `general` | 通用 Agent | 完整 | 复杂任务、多步骤任务 |
| `test` | 测试 Agent | 只读+执行 | 运行测试、验证结果 |
| `doc` | 文档 Agent | 读写 | 生成文档、更新 README |

**权限继承机制**：
- 子 Agent 从父 Agent 继承 deny 规则
- 子 Agent 类型的权限与父权限合并
- 父 Agent 的 deny 规则优先级最高

**系统提示继承**：
- 子 Agent 继承父 Agent 的系统提示
- 子 Agent 类型的系统提示追加到末尾
- 支持自定义系统提示

### 3.4 流式输出模式

所有 Agent（主 Agent 和子 Agent）都使用 Anthropic SDK 的流式 API：

```javascript
const stream = await client.messages.create({
  model,
  system: [{ type: 'text', text: systemPrompt }],
  messages,
  tools,
  max_tokens: 16000,
  stream: true, // 启用流式模式
});

for await (const event of stream) {
  if (event.type === 'content_block_delta') {
    const delta = event.delta;
    if (delta.type === 'text_delta') {
      // 实时推送文本块到前端
      this._broadcastChunk(taskId, agentId, delta.text, false);
    }
  }
}
```

**流式模式的优势**：
- 不增加 token 消耗（只是传输方式不同）
- 实时可见每个 token 的生成
- 更好的用户体验
- 更容易调试和监控

### 3.5 优势

- **上下文隔离**：每个子 Agent 拥有独立上下文窗口，不会因为累积而超出限制
- **配置独立**：不同节点可使用不同的模型、技能、系统提示词
- **进程隔离**：一个子 Agent 崩溃不会影响其他子 Agent 或主流程
- **安全沙箱**：每个子进程独立受限在工作区目录内
- **类型安全**：Subagent 类型自动配置权限和系统提示
- **实时可见**：流式输出让用户看到每个 token 的生成

---

## 五、工作流执行引擎

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
  Subagent 类型说明（Explore（只读）/ general-purpose（完整））,
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
        执行工具（SDK query() 子进程 / Bash / Read 等）
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
| **agent** | 主 Agent 通过 SDK tool_use 循环调用，按节点配置的模型/技能/提示词执行，支持 Subagent 类型和权限继承 |
| **parallel** | 单次 SDK 消息中原子派发多个 Agent，并发执行 |
| **approval** | 暂停执行 → WebSocket 通知前端 → 等待用户操作 → resolve/reject |
| **merge** | 收集直接上游输出，用 `---` 分隔合并 |
| **subworkflow** | 递归调用另一个工作流，记忆回传父工作流 |
| **condition** | 根据输出匹配文本，路由到不同分支（true/false） |
| **end** | 汇总上游输出，生成最终结果 |

---

## 六、检查点与断点续传

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

## 七、审批与并行节点

### 7.1 审批节点

审批节点是**真实的 WebSocket 往返**：

```
执行到达审批节点
  → 节点状态设为 waiting_approval
  → WebSocket 广播 workflow.approvalRequested 事件
  → 前端弹出审批弹窗
  → 后端创建 Promise，等待用户操作
  → 超时保护：可配置（默认 1 小时），超时自动通过

用户操作：
  ├── 通过 → Promise resolve → 节点标记 completed → 继续下游
  └── 拒绝 → Promise reject → 节点标记 failed → 可根据配置跳过
```

**超时配置：**
- 前端：工作流构建器 → 审批节点 → 超时设置（秒）
- 后端：读取 `node.config.timeout`，默认 3600 秒（1小时）

### 7.2 条件节点

条件节点使用 **AI 自动判断**，而非固定文本匹配：

```
执行到达条件节点
  → 读取"判断依据"描述
  → 读取上游节点输出
  → 使用轻量级 AI 模型评估条件
  → 返回 JSON: { pass: boolean, reason: string }
  → 根据结果选择分支
```

**配置方式：**
- 前端：工作流构建器 → 条件节点 → "判断依据"（textarea）
- 后端：`MasterAgentService.buildSystemPrompt()` 注入判断逻辑

**与旧版区别：**
| 旧版 | 新版 |
|------|------|
| 固定文本匹配 | AI 自动判断 |
| "条件匹配文本"输入框 | "判断依据"描述框 |
| 精确匹配 | 语义理解 |

### 7.3 并行节点

并行节点在同一轮 tool_use 中**原子派发多个子 Agent**：

```
执行到达并行节点
  → TS 状态机检测到多条出边
  → 使用 Promise.all 并行调用 query()
  → 所有子 Agent 同时启动（独立子进程）
  → 一个子 Agent 失败不影响其他子 Agent
  → 全部完成后，合并输出传往下游
```

关键实现：
- TS 状态机直接控制并行执行
- 使用 `Promise.all` 而非 `Promise.allSettled` 确保容错
- 每个子 Agent 使用独立的 worktree 隔离

---

## 八、前端-后端通信

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

### 7.3 WebSocket 广播格式

所有 WebSocket 消息统一使用 `{ type, payload }` 格式：

```json
{
  "type": "chat.stream",
  "payload": { "sessionId": "...", "chunk": "hello", "done": false }
}
```

### 7.4 WebSocket 事件

| 事件 | 方向 | 说明 |
|------|------|------|
| `chat.stream` | 后端→前端 | AI 对话实时流式输出 |
| `chat.titleUpdated` | 后端→前端 | 对话标题自动生成 |
| `workflow.statusUpdate` | 后端→前端 | 工作流整体状态变化 |
| `workflow.nodeUpdate` | 后端→前端 | 单节点状态更新 |
| `workflow.approvalRequested` | 后端→前端 | 审批节点等待人工操作 |
| `workflow.created/updated/deleted` | 后端→前端 | 工作流 CRUD 事件 |
| `agent.created/updated/deleted` | 后端→前端 | Agent CRUD 事件 |
| `task.created/updated/deleted` | 后端→前端 | 任务 CRUD 事件 |
| `task.completed/failed/progress` | 后端→前端 | 任务执行状态 |
| `queue.*` | 后端→前端 | 队列事件（启动/暂停/完成等） |
| `workspace.changed` | 后端→前端 | 工作区切换通知 |
| `client.count` | 后端→前端 | 在线客户端数量 |

### 7.5 流式输出处理

```
SDK query() 返回消息流
  → 后端解析 assistant 消息中的 text block
  → WebSocket 广播 chat.stream 事件（50ms 合流缓冲）
  → 前端追加到对话窗口
  → done: true → 加载持久化消息
```

### 7.5 WebSocket 重连

- 指数退避：1s → 1.5s → 2.25s → ... → 30s（最大）
- 最多 10 次重试
- 重连成功后自动触发 `ws:reconnected` 事件
- 各页面组件监听该事件，重新加载最新数据
- 心跳间隔：客户端 25 秒 ping，服务端 30 秒超时

---

## 九、数据库设计（概念）

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

## 十、工作区沙箱与安全

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

## 十一、技能注入流程

### 10.1 技能来源

| 来源 | 数量 | 说明 |
|------|------|------|
| Anthropic 官方技能 | 来自 anthropics/skills | 官方维护的技能集合 |
| ECC 社区技能 | 来自 affaan-m/ECC | 第三方精选技能 |
| 市场总计 | **动态更新** | 覆盖多个分类 |

### 10.2 安装机制

安装技能时，系统自动创建实际的 SKILL.md 文件：

```
用户点击"安装" → SkillService.install()
  → 在 .claude/skills/{skillId}/ 目录创建 SKILL.md
  → SKILL.md 包含 frontmatter（name, description, user-invocable）
  → SDK 执行时自动发现 .claude/skills/ 下的技能文件
```

### 10.3 注入流程

```
Agent 节点准备执行
  → 查询该 Agent 已安装的技能列表（SkillService.getSkillIdsByAgent）
  → 传入 SDK query() 的 skills 选项
  → SDK 子进程自动发现 .claude/skills/ 目录下的 SKILL.md
  → 技能内容注入到 Agent 的上下文中
```

### 10.4 卸载

- 删除 .claude/skills/{skillId}/ 目录
- 如果其他 Agent 还在使用该技能，保留文件
- 安装记录从内存中移除

---

## 十二、记忆系统

### 12.1 存储结构

```
workspace/<wsId>/.context/
├── <workflow-id>.md           # 工作流记忆（Markdown 格式）
├── <workflow-id>.md.bak       # 归档备份
└── shared/
    └── pool.json              # 共享数据池
```

### 12.2 记忆开关（memoryEnabled）

**默认关闭**，只有显式开启才注入记忆。

| 配置 | 行为 | Token消耗 |
|------|------|-----------|
| `memoryEnabled: false`（默认） | 不注入任何记忆，不保存执行记录 | 0 |
| `memoryEnabled: true` | 注入历史记忆，保存执行记录 | ~10,000 tokens |

**配置方式：** 工作流设置 → 记忆传递设置 → 启用记忆注入

**设计理由：**
- 每次工作流执行都是全新的Agent（无会话复用）
- 记忆只是"参考笔记"，不是"对话历史"
- 简单任务不需要记忆，避免浪费Token

### 12.3 记忆写入

仅在 `memoryEnabled: true` 时，工作流执行完成后自动从输出中提取：

1. **输出摘要**：过滤噪音，提取有意义的核心内容
2. **Agent 主动记忆**：提取输出中的 `[记忆: xxx]` 或 `[Memory: xxx]` 标记
3. **任务标签**：使用任务输入的前 50 字符作为标签

记忆格式：`## Session {时间戳} | {任务标签}`，支持按任务关键词过滤。

去重检查：若与上次记录的 70% 以上行相同，跳过写入。
自动压缩：总长度超过 15000 字符时，保留最近 5 次完整记录，更早的只保留标题。

### 12.4 记忆注入

仅在 `memoryEnabled: true` 时，子 Agent 执行前注入：

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

## 十三、自我修复与容错

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

## 十四、数据持久化机制

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

## 十五、技术参数汇总

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
| Subagent 类型 | 2 种（Explore 只读 / general-purpose 完整） |
| 流式模式 | 所有 Agent 使用 Anthropic SDK 流式 API |
| 权限继承 | 子 Agent 从父 Agent 继承 deny 规则 |
| 系统提示继承 | 子 Agent 继承父 Agent 的系统提示 |

---

## 十六、功能模块

侧边栏分为 4 个分组，共 16 个页面：

### 核心

| 模块 | 说明 |
|------|------|
| **控制面板** | 仪表盘：CPU/内存实时采样、智能体数量、活跃工作流、待处理任务、对话/终端会话数（5 张 SVG 图标统计卡片）。支持深浅主题切换 |
| **智能体** | 创建和管理 AI Agent，配置模型（opus/sonnet/haiku 别名）、系统提示词、温度、工具权限、角色预设 |
| **工作流** | 可视化拖拽编排，支持 8 种节点类型（含条件分支）、AI 创建、批量克隆、流程图导入/导出、记忆传递、知识注入 |
| **文件** | 工作区文件树浏览、文件预览/编辑、新建文件/文件夹、工作区管理 |
| **任务** | 创建/执行/管理任务，关联工作流，任务队列批量执行，实时状态更新 |

### 工具

| 模块 | 说明 |
|------|------|
| **终端** | xterm.js + node-pty 真实 PTY 终端，多会话管理（上限 10 个），WebSocket 实时输出推送，自动在当前工作区路径打开 |
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
| **市场** | 技能市场（动态更新）+ 工作流模板（13 个内置） |
| **广播** | 事件广播和通知管理 |
| **设置** | 系统配置、偏好设置、审计日志、提示词模板、API Key 管理 |

---

## 十七、智能体配置

| 配置项 | 说明 |
|--------|------|
| 模型 | opus（最强推理）/ sonnet（平衡）/ haiku（快速轻量） |
| 系统提示词 | 定义 Agent 行为方式 |
| 温度 | 控制输出随机性（0-1） |
| 工具权限 | 读文件、写文件、执行命令等 |
| 角色预设 | 开发者、审查员、测试员、规划师、调试员、文档员、自定义 |

---

## 十八、工作区管理

### 18.1 工作区结构

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

### 18.2 工作区持久化

**存储位置：** `data/active-workspaces.json`

**持久化机制：**
- 工作区激活时自动保存到文件
- 服务器启动时自动恢复工作区
- 停用工作区时从列表移除并持久化
- 禁止停用最后一个工作区（至少保留一个活跃工作区）

**工作流创建约束：**
- 必须有活跃工作区才能创建工作流
- 无工作区时提示用户先激活工作区

**数据结构：**
```json
[
  {
    "id": "ws_xxx",
    "path": "D:/path/to/workspace",
    "name": "workspace-name",
    "activatedAt": "2026-06-01T00:00:00.000Z",
    "workflowData": [],
    "agentData": []
  }
]
```

**实现位置：** `WorkspaceManager.ts`
- `init()` - 启动时恢复工作区
- `activate()` - 激活工作区并持久化
- `deactivate()` - 停用工作区并持久化
- `_persist()` - 保存到文件
- `restoreAll()` - 从文件恢复

---

## 十九、数据存储

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

## 二十、安全与鉴权

- **API Key 鉴权**：首次启动自动生成，AES-256-GCM 加密存储
- **三层限流**：全局 600 次/分钟、写操作 200 次/10 秒、鉴权 10 次/分钟
- **工作区沙箱**：`--permission-mode acceptEdits` 限制工作区内写入
- **路径穿越防护**：所有文件路径通过 resolvePath 校验
- **Agent 内存沙箱**：每 10 秒监测 RSS，超过 2GB 自动终止进程
- **工具白名单**：Edit/Write（限工作区）、Read、Bash（仅读命令）、Agent、Glob/Grep
- **日志持久化**：`logs/app-YYYY-MM-DD.log` 每日轮转，自动清理 30 天前日志

---

## 二十一、错误分类与自适应重试

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

## 二十二、性能优化

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

## 二十三、API 概览

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

## 二十四、批处理脚本

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

## 二十五、Claude Agent SDK 深度集成（2026-06-01 新增）

### 24.1 架构升级概述

本次升级将工作流执行引擎从"主Agent编排模式"升级为"TS强状态机驱动模式"，彻底解决了主Agent偷懒模拟子Agent执行的问题。

**核心原则：** "脑子归 AI，手脚归代码" — TypeScript 代码直接控制工作流执行，主Agent无法"假装运行"子Agent。

### 24.2 TS 强状态机驱动执行

```
┌─────────────────────────────────────────────────────────────┐
│                    执行架构对比                               │
├─────────────────────────────────────────────────────────────┤
│ 旧架构：主Agent → 调用Agent工具 → 可能偷懒自己写文件          │
│ 新架构：TS代码 → 直接调用query() → 物理启动子进程            │
└─────────────────────────────────────────────────────────────┘
```

**实现位置：** `WorkflowService._executeWorkflowStateMachine()`

**执行流程：**
1. 解析工作流 DAG（节点和边）
2. 拓扑排序确定执行顺序
3. 按顺序直接调用 `query()` 执行每个节点
4. 并行节点使用 `Promise.all` 同时执行
5. 条件节点使用轻量级 AI 评估
6. 审批节点通过 `Promise` 挂起等待人工确认

### 24.3 Claude Agent SDK 集成

**实现位置：** `SdkService._executeWithClaudeSdk()`

```typescript
const { query } = require('@anthropic-ai/claude-agent-sdk');

const queryOptions = {
  cwd: workingDir,
  model: resolvedModel,
  systemPrompt: systemPrompt,
  permissionMode: 'bypassPermissions',
  maxTurns: 50,
  allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
  signal: abortController?.signal,  // 物理级进程控制
  env: { ...process.env, ...claudeEnv },
  hooks: {
    PreToolUse: [{ matcher: ".*", callback: async (input) => { ... } }],
    PostToolUse: [{ matcher: ".*", callback: async (input) => { ... } }]
  }
};

for await (const message of query({ prompt, options: queryOptions })) {
  // 处理消息流
}
```

### 24.4 PreToolUse Hook 安全拦截

**实现位置：** `SdkService._handlePreToolUse()`

**功能：**
- 安全拦截危险命令（`rm -rf /`、`mkfs`、fork bomb 等）
- 审批节点支持（暂停等待人工确认）
- 实时广播安全检查事件

```typescript
hooks: {
  PreToolUse: [{
    matcher: ".*",
    callback: async (input) => {
      // 安全拦截
      if (toolName === 'Bash' && isDangerous(command)) {
        return { hookSpecificOutput: { permissionDecision: 'deny' } };
      }
      // 审批节点
      if (needsApproval) {
        return await waitForHumanApproval();
      }
      return { hookSpecificOutput: { permissionDecision: 'allow' } };
    }
  }]
}
```

### 24.5 AbortController.signal 物理级控制

**功能：** 通过操作系统信号物理终止子进程，杜绝僵尸进程。

```typescript
const abortController = new AbortController();

// 传递给SDK
query({ options: { signal: abortController.signal } });

// 物理终止
abortController.abort('TIMEOUT');  // 或 'ABORTED', 'SHUTDOWN'
```

### 24.6 EventEmitter 实时状态报告

**实现位置：** `SdkService extends EventEmitter`

**事件列表：**

| 事件 | 触发时机 | 数据 |
|------|----------|------|
| `task_started` | 任务启动 | taskId, agentId, model, cwd |
| `progress` | Token级输出 | taskId, text |
| `tool_use` | 工具调用 | taskId, toolName, toolInput, toolUseId |
| `tool_result` | 工具结果 | taskId, toolUseId, toolResult |
| `completed` | 任务完成 | taskId, result |
| `failed` | 任务失败 | taskId, error |
| `security_check` | 安全检查 | taskId, toolName, toolInput |
| `tool_executed` | 工具执行完成 | taskId, toolName, toolOutput |
| `autonomous_passed` | 自治判断通过 | taskId, attempts |
| `autonomous_failed` | 自治判断失败 | taskId, attempts, reason |
| `hitl_approved` | 人工审批通过 | taskId, attempts |
| `hitl_rejected` | 人工审批拒绝 | taskId, attempts, feedback |

### 24.7 自治判断节点（Autonomous Decision）

**实现位置：** `SdkService.executeAutonomousDecisionFlow()`

**功能：** AI自动验证子Agent输出质量，不通过则自动重试。

```typescript
async executeAutonomousDecisionFlow(taskId, prompt, workspaceRoot, maxAttempts = 3) {
  while (!isPassed && attempts < maxAttempts) {
    // 1. 运行子Agent生成代码
    lastResult = await this._executeWithClaudeSdk(...);

    // 2. 启动评估Agent审查代码
    evalResult = this._parseJsonSafely(evalRaw);

    if (evalResult.pass) {
      isPassed = true;
    } else {
      // 3. 反馈重试
      currentPrompt = `根据反馈修改: ${evalResult.reason}`;
    }
  }
}
```

### 24.8 Fork-Join 并行分叉与汇聚

**实现位置：** `SdkService.executeForkJoinFlow()`

**功能：** 同时分发多个独立任务，完成后汇聚结果。

```typescript
async executeForkJoinFlow(tasks, mergePrompt, workspaceRoot) {
  // 1. 串行创建worktree（带锁保护）
  for (const task of tasks) {
    await this._createWorktreeWithLock(task.id, workspaceRoot);
  }

  // 2. 并行执行所有子Agent
  const results = await Promise.all(
    tasks.map(task => this._agentLimit(() => this._executeWithClaudeSdk(...)))
  );

  // 3. 汇聚结果
  const finalResult = await this._executeWithClaudeSdk(mergeTaskId, ...);
}
```

### 24.9 HITL 人工审核（带反馈回滚）

**实现位置：** `SdkService.executeHumanInTheLoopFlow()`

**功能：** 生成内容后等待人工确认，不通过则根据反馈重新生成。

```typescript
async executeHumanInTheLoopFlow(taskId, prompt, workspaceRoot) {
  while (!isApproved && attempts < maxAttempts) {
    // 1. 生成内容
    lastResult = await this._executeWithClaudeSdk(...);

    // 2. 广播审批请求
    this.broadcastService.broadcast('workflow.approvalRequested', { ... });

    // 3. 挂起等待审批
    const approval = await new Promise((resolve) => {
      this._pendingApprovals.set(approvalId, { resolve });
    });

    if (!approval.approved) {
      feedback = approval.feedback;
    }
  }
}
```

### 24.10 并发控制与资源管理

| 功能 | 实现 | 说明 |
|------|------|------|
| Agent并发限制 | `pLimit(5)` | 最多5个子Agent同时运行 |
| Git操作串行锁 | `pLimit(1)` | 防止worktree锁冲突 |
| JSON安全解析 | `_parseJsonSafely()` | 防止解析崩溃 |
| 关机清理 | `shutdownAll()` | 优雅关闭所有子进程 |
| 调用树追踪 | `_trackToolCall()` | 级联调用监控 |

### 24.11 实时工具调用监控

**实现方式：** 通过解析SDK消息流中的 `tool_use` 块实现。

```typescript
// 解析 assistant 消息中的 tool_use 块
if (message.type === 'assistant') {
  for (const block of content) {
    if (block.type === 'tool_use') {
      // 实时捕获工具调用
      this.emit('tool_use', { taskId, toolName, toolInput, toolUseId });
      this.broadcastService.broadcast('agent.tool_use', { ... });
    }
    if (block.type === 'tool_result') {
      // 实时捕获工具结果
      this.emit('tool_result', { taskId, toolUseId, toolResult });
    }
  }
}
```

**前端WebSocket事件：**

| 事件 | 说明 |
|------|------|
| `agent.tool_use` | 工具调用（实时） |
| `agent.tool_result` | 工具结果（实时） |
| `agent.tool_executed` | 工具执行完成 |
| `agent.security_check` | 安全检查 |
| `agent.tool_blocked` | 工具被拦截 |

### 24.12 Agent 类型映射

**Claude Agent SDK 实际支持的类型：**

| SDK类型 | 权限 | 用途 |
|---------|------|------|
| `Explore` | 只读 | 搜索、分析（不能创建文件） |
| `general-purpose` | 完整 | 开发、测试、文档（可创建文件） |

**系统提示词自动推断逻辑：**
- 搜索/分析类任务 → `Explore`
- 开发/测试/文档类任务 → `general-purpose`
- 默认 → `general-purpose`

---

## 二十六、双轨闭环架构（2026-06-03 新增）

### 26.1 架构概述

本次升级将工作流执行引擎从"TS状态机直接调用"升级为"双轨闭环架构"，实现了主Agent协调 + 子Agent执行的分离。

**核心原则：** "工具链物理去能" — 主Agent被剥夺所有直接工具，只能通过 `call_sub_agent` 调度子Agent。

### 26.2 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    双轨闭环架构                               │
├─────────────────────────────────────────────────────────────┤
│ 主Agent（原生 Anthropic API）                                │
│ ├── tools: [call_sub_agent]  ← 唯一工具                     │
│ ├── system: 系统提示词                                       │
│ └── 手动消息循环（while + anthropic.messages.create）        │
│           ↓                                                 │
│ TS层拦截 call_sub_agent                                     │
│ ├── executeRoutedStep()                                     │
│ ├── 创建 worktree 隔离                                      │
│ └── 调用 SubAgentRunner                                     │
│           ↓                                                 │
│ 子Agent（Claude Agent SDK）                                  │
│ ├── query({ prompt, options })                              │
│ ├── allowedTools: [Read, Write, Edit, Bash, ...]            │
│ └── 在 worktree 中执行任务                                   │
└─────────────────────────────────────────────────────────────┘
```

### 26.3 关键实现

**WorkflowOrchestrator.ts** - 主控编排器

```typescript
// 手动消息循环
while (keepRunning && iteration < maxIterations && !this.stopped) {
  const response = await this.anthropic.messages.create({
    model: resolvedModel,
    system: systemPrompt,
    messages: messages,
    tools: MASTER_TOOLS  // 仅 call_sub_agent
  });

  const toolCalls = response.content.filter(b => b.type === 'tool_use');

  if (toolCalls.length > 0) {
    // 并行执行所有工具调用
    const toolResults = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const realResult = await this.executeRoutedStep(agent_type, prompt);
        return { type: 'tool_result', tool_use_id: toolUseId, content: realResult };
      })
    );
    messages.push({ role: 'user', content: toolResults });
  } else {
    keepRunning = false;
  }
}
```

**SubAgentRunner.ts** - 子Agent进程管理器

```typescript
// 子Agent执行
const stream = query({
  prompt: task.description,
  options: {
    model: task.model,
    allowedTools: task.allowedTools,
    cwd: task.worktree,
    systemPrompt: task.systemPrompt,
    skills: task.skills,
    env: { ANTHROPIC_API_KEY: apiKey }
  }
});

// 50ms防抖输出
for await (const message of stream) {
  if (message.type === 'assistant') {
    chunkBuffer += text;
    if (!debounceTimeout) {
      debounceTimeout = setTimeout(() => {
        this.emit('progress', { id: this.id, text: chunkBuffer });
      }, 50);
    }
  }
}
```

### 26.4 工作流节点类型

| 节点类型 | 实现方式 | 说明 |
|----------|----------|------|
| start | TS代码 | 标记完成，透传输入 |
| agent | call_sub_agent → SubAgentRunner | AI执行任务 |
| evaluator | call_sub_agent → SubAgentRunner | AI审查，返回JSON {pass, reason} |
| approval | request_approval → Promise挂起 | 暂停等待人工审批 |
| subworkflow | 内联展开子工作流节点 | 递归执行 |
| 并行执行 | Promise.all + 同一轮多个tool_use | 并发执行 |
| 汇聚节点 | 等待上游输出作为上下文 | 传递上游结果 |
| end | TS代码 | 汇总最终结果 |

### 26.5 自愈循环

```
coder 创建代码
    ↓
evaluator 审查
    ↓
pass = true  → 继续下游
pass = false → 主Agent调用 coder 重新修改（自愈循环）
```

### 26.6 工作流停止

```typescript
// WorkflowService.stop()
const orchestrator = WorkflowService._activeOrchestrators.get(id);
if (orchestrator) {
  await orchestrator.shutdownAll();  // 停止所有子Agent
}

// WorkflowOrchestrator.shutdownAll()
this.stopped = true;  // 阻止新的子Agent启动
for (const [id, runner] of this.activeRunners) {
  runner.kill();  // 强制关闭子Agent
}
```

### 26.7 Session 恢复

```typescript
// 捕获 session_id
if (message.session_id && !this.sessionId) {
  this.sessionId = message.session_id;
  this.emit('session_captured', { id: this.id, sessionId: this.sessionId });
}

// 持久化到文件
stateStore.save(`agent:${taskId}`, { sessionId, status: 'running' });

// 崩溃恢复
if (task.resumeSessionId) {
  queryOptions.resume = task.resumeSessionId;
}
```

---

## 二十七、数据分析与统计系统

### 27.1 执行统计

系统自动统计所有工作流的执行数据：

```typescript
// 统计指标
{
  total: number;        // 总执行次数
  completed: number;    // 成功次数
  failed: number;       // 失败次数
  successRate: number;  // 成功率 (0-100%)
  avgDuration: number;  // 平均耗时 (秒)
  byWorkflow: Array<{   // 按工作流统计
    name: string;
    executions: number;
    completed: number;
    failed: number;
    avgDuration: number;
  }>
}
```

### 27.2 数据持久化

executionLog 在工作流完成/失败时通过 `_flush()` 强制同步保存：

```typescript
// 完成时更新
logEntry.status = 'completed';
logEntry.completedAt = new Date();
WorkflowModel.update(workflowId, { executionLog });
WorkflowModel._flush();  // 强制同步写入磁盘

// 失败时更新
logEntry.status = 'failed';
logEntry.completedAt = new Date();
WorkflowModel.update(workflowId, { executionLog });
WorkflowModel._flush();
```

### 27.3 崩溃恢复

服务器启动时自动修复卡在 `running` 状态的执行记录：

```typescript
static fixStaleExecutionLogs(): void {
  for (const wf of workflows) {
    for (const log of wf.executionLog) {
      if (log.status === 'running') {
        log.status = 'failed';  // 服务器重启 = 异常中断
        log.completedAt = log.startedAt || new Date();
      }
    }
  }
}
```

---

## 二十八、任务优先级系统

### 28.1 优先级定义

| 优先级 | 权重 | 说明 |
|--------|------|------|
| urgent | 4 | 紧急 |
| high | 3 | 高 |
| medium | 2 | 中（默认） |
| low | 1 | 低 |

### 28.2 排序算法

任务列表按 **优先级权重降序 + 创建时间升序** 排序：

```typescript
const PRIORITY_WEIGHT = { urgent: 4, high: 3, medium: 2, low: 1 };

results.sort((a, b) => {
  // 先按优先级权重降序
  const weightDiff = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
  if (weightDiff !== 0) return weightDiff;
  // 同优先级按创建时间升序（FIFO）
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
});
```

### 28.3 排序示例

```
[紧急] 修复线上Bug      ← 最先执行
[高]   开发新功能A       ← 第二
[中]   任务A (10:00创建) ← 同优先级按时间
[中]   任务B (10:05创建) ← 排在A后面
[低]   代码重构          ← 最后
```

---

## 二十九、工作区工作流统计

### 29.1 实时统计

工作区列表 API 从文件系统实时读取每个工作区的工作流数量：

```typescript
router.get('/', (req, res) => {
  const workspaces = WorkspaceManager.getActive();

  const enriched = workspaces.map(ws => {
    // 从 WORKFLOWS/workflows.json 读取
    const wfPath = path.join(ws.path, 'WORKFLOWS', 'workflows.json');
    const data = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
    return { ...ws, workflowCount: data.length };
  });

  res.json({ success: true, data: enriched });
});
```

### 29.2 跨工作区隔离

- 每个工作区独立的 `WORKFLOWS/workflows.json` 文件
- 切换工作区不影响其他工作区的数据
- 工作流在启动时锁定工作区路径，后续执行不受切换影响

---

## 三十、系统资源监控

### 30.1 CPU 使用率计算

采用 **两次采样差值** 计算实时 CPU 使用率：

```typescript
private static _lastCpuSample: { idle: number; total: number } | null = null;

static async getStats(): Promise<any> {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  }

  let cpuUsage = 0;
  if (this._lastCpuSample) {
    const idleDiff = totalIdle - this._lastCpuSample.idle;
    const totalDiff = totalTick - this._lastCpuSample.total;
    cpuUsage = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
  }
  this._lastCpuSample = { idle: totalIdle, total: totalTick };

  return { cpu: { usage: cpuUsage }, memory: { ... } };
}
```

### 30.2 自动刷新

控制台系统资源每 **5 秒** 自动刷新一次。

---

## 三十一、安全改进

### 31.1 命令注入防护

AI 对话执行命令时，禁用 `shell: true` 并添加命令白名单：

```typescript
// 只允许只读命令
const SAFE_COMMANDS = ['ls', 'dir', 'cat', 'type', 'head', 'tail', 'wc', 'grep', 'find', 'echo', 'pwd', 'whoami', 'date', 'env'];

// 解析命令和参数，避免 shell 注入
const parts = command.trim().split(/\s+/);
const cmd = parts[0];
const args = parts.slice(1);

spawn(cmd, args, { shell: false });  // 禁用 shell
```

### 31.2 并发执行防护

工作流执行前检查是否已在运行：

```typescript
static execute(id: string, ...): ExecuteResult {
  const workflow = WorkflowModel.findById(id);
  
  // 防止并发执行
  if (workflow.executionStatus === 'running') {
    throw new AppError('CONFLICT', `工作流正在运行中，请等待完成后再执行`, 409);
  }
  
  // ... 继续执行
}
```

### 31.3 AI 对话只读模式

AI 对话工具限制为只读：

```typescript
tools: [
  { type: 'web-search' },      // 网络搜索
  { type: 'web-fetch' },       // 获取网页
  { type: 'file-read' },       // 读取文件
  { type: 'file-search' },     // 文件名搜索 (Glob)
  { type: 'content-search' }   // 文件内容搜索 (Grep)
]
```

### 31.4 审批弹框改进

审批弹框支持直接输入备注：

```
┌─────────────────────────────────────┐
│ 审核: 任务标题                       │
├─────────────────────────────────────┤
│ 审核内容...                          │
│                                     │
│ 审核备注（可选）                      │
│ ┌─────────────────────────────────┐ │
│ │ 输入审核意见或备注...             │ │
│ └─────────────────────────────────┘ │
│        [拒绝]  [通过]                │
└─────────────────────────────────────┘
```

- 通过时备注可选
- 拒绝时必须填写原因

---

## 三十二、代码质量优化

### 32.1 死代码清理

删除了约 480 行无用代码：

| 函数 | 说明 |
|------|------|
| `_executeMasterAgent` | 旧的执行方式，已被 Orchestrator 替代 |
| `_executeWorkflowStateMachine` | 旧的状态机方式，已废弃 |
| `parseSimpleText` | 未使用的解析函数 |
| `StreamProcess` | 未使用的接口 |
| `_activeStreams` | 未使用的 Map |

### 32.2 数据分析统计

执行统计通过 `_flush()` 强制同步保存：

```typescript
logEntry.status = 'completed';
logEntry.completedAt = new Date();
WorkflowModel.update(workflowId, { executionLog });
WorkflowModel._flush();  // 强制写入磁盘
```

### 32.3 崩溃恢复优化

服务器启动时修复卡在 running 的执行记录：

```typescript
static fixStaleExecutionLogs(): void {
  for (const log of workflow.executionLog) {
    if (log.status === 'running') {
      // 有 checkpoint → interrupted（可恢复）
      // 无 checkpoint → failed
    }
  }
}
```

---

## 三十三、工作流执行优化（2026-06-05 新增）

### 33.1 移除 Worktree 隔离

**改动原因：** Worktree 隔离导致下游节点无法看到上游节点创建的文件，产出物也无法合并回主工作区。

**新架构：**
```
工作流开始
    ↓
所有子 Agent 直接在主工作区执行
    ↓
工作流结束（产出物已在工作区）
```

**优点：**
- 子 Agent 之间天然共享文件
- 产出物直接在工作区，无需合并
- 代码更简单，问题更少

**注意事项：**
- 多个工作流同时执行时，通过提示词指定文件夹避免冲突
- 子 Agent 只能访问工作区内的文件（安全限制）

### 33.2 工作流指令生成优化

**问题：** 分叉节点（有多个下游的节点）被跳过，直接执行下游并行节点。

**修复：** 先生成当前节点指令，再生成下游并行指令。

```typescript
// 修复前：只生成下游节点指令
if (downstream.length > 1) {
  // 生成并行指令（跳过了当前节点）
}

// 修复后：先生成当前节点，再生成下游并行
stepNum++;
steps.push(`步骤 ${stepNum}: **${node.label}** ...`);
processedNodes.add(nodeId);

if (downstream.length > 1) {
  stepNum++;
  // 生成并行指令
}
```

**执行顺序示例：**
```
n1 (开始) → n3 (任务规划师) → n4 (前端) ─┐
                            n5 (后端) ─┤→ n8 (审核员) → n9 (条件判断) → n2 (结束)
```

### 33.3 审核员只读约束

**问题：** 审核员节点的自定义提示词覆盖了系统提示词，导致审核员写代码而不是只评估。

**修复：** 为 evaluator 类型节点自动添加只读约束：

```typescript
if (agentType === 'evaluator') {
  finalTask = `${task}\n\n⚠️ 重要约束：你只负责评估和审核，绝对不要编写测试代码、修改文件或创建新文件。只读取现有代码并给出评审结果。`;
}
```

### 33.4 知识库持久化

**问题：** 知识库数据只在内存中，服务器重启后丢失。

**修复：** 添加本地持久化，存储在 `WORKFLOWS/knowledge.json`：

```typescript
class KnowledgeService {
  static init(workspacePath: string): void {
    this._persistPath = path.join(workspacePath, 'WORKFLOWS', 'knowledge.json');
    this._load();
  }

  private static _persist(): void {
    atomicWriteSync(this._persistPath, JSON.stringify(data, null, 2));
  }
}
```

### 33.5 文件访问限制

**安全增强：** 子 Agent 只能访问工作区内的文件。

```typescript
// PreToolUse 钩子中检查文件路径
if (pathTools.includes(toolName) && workspaceRoot) {
  const filePath = toolInput?.file_path || toolInput?.path || '';
  if (filePath) {
    const resolved = path.resolve(filePath);
    const normalizedRoot = path.resolve(workspaceRoot);
    if (!resolved.startsWith(normalizedRoot)) {
      logger.warn(`[安全] 拒绝访问工作区外文件: ${filePath}`);
      return { hookSpecificOutput: { permissionDecision: 'deny' } };
    }
  }
}
```

### 33.6 工作流克隆修复

**问题：** 克隆工作流时 `folderPath` 未更新为目标工作区路径，导致执行时使用原工作区。

**修复：** 克隆时将 `folderPath` 设置为目标工作区路径：

```typescript
const clone = {
  ...wf,
  id: generateId(),
  workspaceId: targetWsId,
  folderPath: targetWs.path,  // 更新为目标工作区路径
  // ...
};
```

---

*文档基于 git master 分支最新提交*
