[English](README_EN.md) | 中文

> ⚠️ **开发状态：实验性预览版** — 本项目由知识面较浅薄的大一学生自行开发，功能可能有很多不完善之处，存在未发现的 Bug。**未经充分生产环境测试，请不要用于重要文件的修改上。** 欢迎 Fork 自行修改。维护时间有限，Issue 和 PR 处理可能不及时。

# Claude Agent Studio

一个基于 Web 的可视化平台，用于编排、监控和管理多个 Claude Code Agent 协作完成复杂任务。支持拖拽式工作流、实时流式输出、断点续传、记忆传递和技能市场。

<p align="center">
  <img src="screenshots/控制台.png" alt="控制面板" width="45%">
  <img src="screenshots/工作流.png" alt="工作流编辑器" width="45%">
</p>
<p align="center">
  <img src="screenshots/市场.png" alt="技能市场" width="45%">
  <img src="screenshots/文件.png" alt="文件管理" width="45%">
</p>

---

## 架构概览

```
Browser (SPA)
  HTML + CSS + Vanilla JS + xterm.js
      │  HTTP + WebSocket
      ▼
Express + WebSocket 服务层
  鉴权 │ 限流 │ 路由 │ 服务 │ 中间件
      │
      ▼
双引擎执行层

  ┌─ 主 Agent (SDK) ──→ 子 Agent (CLI)
  │  tool_use 循环        claude --print
  │  命名 Agent 工具      完整工具集
  │  编排调度             进程隔离
  │
  └─ CLI 不可用时自动回退 SDK 模式

      │
      ▼
数据层
  sql.js │ JSON │ 工作区文件
```

### 双引擎执行模型

| | 主 Agent | 子 Agent |
|---|---|---|
| **引擎** | Anthropic SDK | `claude --print` CLI |
| **机制** | `tool_use` 循环 | 子进程 (spawn) |
| **工具** | 自定义 `Agent_nX` 命名工具 + Bash | 完整工具集 |
| **上下文** | 仅负责编排 | 每节点独立上下文窗口 |
| **隔离** | 共享编排进程 | 真实进程隔离（独立 PID） |
| **配置** | Settings 中配置的 API Key | 节点配置强制指定模型和技能 |

主 Agent 使用 Anthropic SDK 运行 `tool_use` 循环。每个工作流节点映射为一个命名工具（`Agent_n2`、`Agent_n3` 等）。当模型调用某个工具时，后端 spawn 一个独立的 `claude --print` CLI 进程，注入该节点专属的模型、技能和系统提示词。如果 CLI 不可用，子 Agent 自动回退到 SDK 模式。

---

> **快速启动**
>
> 首次使用：双击 **`install.bat`** → 自动安装依赖 → 双击 **`start.bat`** → 访问 **http://localhost:3000**
>
> 双击 **`stop.bat`** 停止服务
>
> 提前安装：[Node.js 18+](https://nodejs.org/) 和 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

---

## 快速开始

### 环境要求

- Node.js 18+
- Claude Code CLI（`npm install -g @anthropic-ai/claude-code`）

### 安装

**方式一：ZIP 分发（推荐）**

解压 ZIP → 双击 `install.bat` → 自动完成依赖安装和初始化

**方式二：命令行**

```bash
npm install
```

### 启动

```bash
npm start
```

> 方式二：双击 `start.bat`（Windows）

访问 http://localhost:3000

### 停止

```bash
Ctrl+C
```

> 方式二：双击 `stop.bat`（Windows）

### 开机自启（Windows）

双击 `add-to-startup.bat` 添加自启，双击 `remove-from-startup.bat` 取消自启。

---

## 快速上手

### 场景 1：让一个 AI 帮你写代码

1. 点左侧 **「智能体」** → 右上角 **「创建智能体」**
2. 填写：
   - **名称**：比如"前端开发助手"
   - **角色预设**：选「开发者」
   - **模型**：Claude Sonnet（默认即可）
   - **系统提示词**：描述它的职责，比如"你是一个 Vue.js 前端工程师"
3. 点 **「保存」**
4. 点左侧 **「任务」** → **「创建任务」**
5. 选择刚才创建的 Agent，输入你的需求，点 **「执行」**
6. 右侧会实时显示 AI 的思考和输出

### 场景 2：搭建多 Agent 流水线

1. 先创建两个 Agent（比如「代码编写员」和「代码审查员」）
2. 点左侧 **「工作流」** → **「创建工作流」**
3. 进入可视化编辑器，从左侧工具栏拖入两个「Agent 节点」
4. 用连线连接它们：`开始 → Agent1 → Agent2 → 结束`
5. 点击每个 Agent 节点，选择对应的 Agent
6. 点 **「保存」**，然后点 **「执行」**

### 场景 3：管理文件

1. 点左侧 **「文件」**
2. 可以浏览、新建、编辑、删除工作区内的文件
3. 所有 Agent 生成的文件也在这里

---

## 核心功能

### 执行引擎

- **双引擎架构**：SDK 主 Agent 编排 + CLI 子 Agent 执行，真实进程隔离
- **命名 Agent 工具**：每个工作流节点映射为 `Agent_n2`、`Agent_n3` 等命名工具，主 Agent 通过 tool_use 循环调度
- **检查点与续传**：每个节点完成后保存 `.checkpoint/` 检查点文件，恢复时跳过已完成步骤
- **暂停与恢复**：abortSignal 即时暂停（< 5 秒），恢复时使用检查点
- **审批节点**：真实 WebSocket 往返 — 执行暂停直到用户审批通过/拒绝
- **并行节点**：单次 SDK 消息中原子派发多个子 Agent

### 功能特性

- **工作流模板（15+）**：预设技能的工作流模板，开箱即用
- **AI 创建工作流**：自然语言描述，AI 自动生成完整工作流 DAG
- **技能市场（249 个）**：来自 anthropics/skills 和 affaan-m/ECC 的真实技能，覆盖 19 个分类
- **多配置 API Key**：AES-256-GCM 加密存储，支持在设置中管理多个 Key
- **WebSocket 实时流式输出**：所有子 Agent 输出实时广播到所有连接的客户端
- **sql.js 持久化**：纯 WASM SQLite，零原生依赖，首次启动自动从 JSON 迁移
- **多工作区支持**：独立环境，独立数据、工作流和配置
- **任务队列**：批量执行，支持暂停/恢复/取消，按顺序处理
- **知识库**：按分类/标签组织，全文搜索，可注入 Agent 执行
- **记忆系统**：按工作流维度积累记忆，支持跨工作流传递、共享数据池、自动压缩
- **审计日志**：完整操作审计，实时持久化，保留最近 1000 条

### 工作流节点类型

| 节点 | 说明 |
|------|------|
| **开始 (Start)** | 工作流入口，透传输入给下游节点 |
| **Agent** | 使用 Anthropic SDK 调用 AI，按配置的模型/技能/提示词执行任务 |
| **并行 (Parallel)** | 单次消息并发派发多个子 Agent |
| **审批 (Approval)** | WebSocket 往返 — 暂停等待用户审批通过或拒绝 |
| **合并 (Merge)** | 收集所有直接上游输出，用 `---` 分隔合并 |
| **子工作流 (Sub-workflow)** | 选择另一个工作流，在编辑器中展开嵌入其所有节点和连线 |
| **结束 (End)** | 汇总所有上游输出，生成最终结果 |

---

## 技术架构

| 层 | 技术 |
|---|---|
| 前端 | HTML + CSS + 原生 JS（SPA）+ xterm.js |
| 后端 | Node.js + Express |
| 实时通信 | WebSocket (ws) |
| AI - 主 Agent | Anthropic SDK (tool_use 循环) |
| AI - 子 Agent | Claude Code CLI (child_process.spawn) |
| 数据持久化 | sql.js (WASM SQLite，零原生依赖) |
| 图标 | SVG sprite（`icons.svg`，40+ 图标） |
| 设计系统 | CSS 变量 + DM Sans / JetBrains Mono |
| 测试 | Jest |

---

## 功能模块

侧边栏分为 4 个分组，共 15 个页面：

### 核心

| 模块 | 说明 |
|------|------|
| **控制面板** | 仪表盘：CPU/内存实时采样、智能体数量、活跃工作流、待处理任务、对话/终端会话数（5 张 SVG 图标统计卡片）。支持深浅主题切换 |
| **智能体** | 创建和管理 AI Agent，配置模型（opus/sonnet/haiku 别名）、系统提示词、温度、工具权限、角色预设 |
| **工作流** | 可视化拖拽编排，支持 7 种节点类型、AI 创建、批量克隆、流程图导入/导出、记忆传递、知识注入 |
| **文件** | 工作区文件树浏览、文件预览/编辑、新建文件/文件夹、工作区管理。支持预览：图片（png/jpg/gif/svg/webp 等）、PDF（内嵌查看）、Markdown（编辑/预览/分屏）、文本文件（代码编辑） |
| **任务** | 创建/执行/管理任务，关联工作流，任务队列批量执行，实时状态更新 |

### 工具

| 模块 | 说明 |
|------|------|
| **终端** | xterm.js 终端模拟器，多会话管理（上限 10 个），PTY 真实终端，会话自定义名称，服务器重启自动恢复 |
| **对话** | AI 多轮对话，支持模型切换、系统提示配置、会话搜索，默认 Haiku，独立工作区运行 |

### 数据

| 模块 | 说明 |
|------|------|
| **成果库** | 自动索引工作区内生成文件，实时监听变化，支持搜索、预览、删除、手动重建索引 |
| **知识库** | 个人知识管理，按分类/标签组织，全文搜索，导入/导出（JSON/CSV/Markdown），注入 Agent 执行 |
| **记忆** | 工作流记忆系统（按工作流维度），跨工作流传递、共享数据池、Agent 主动记忆、自动压缩 |
| **数据分析** | 执行统计、按工作流统计、执行时间线视图，支持批量选择/删除 |
| **历史** | 所有工作流执行历史，查看详情/报告、跳转只读视图、批量删除 |
| **报告** | 执行报告查看和管理 |

### 系统

| 模块 | 说明 |
|------|------|
| **市场** | 技能市场（249 个技能，19 个分类）+ 工作流模板（15+ 个内置），支持搜索、分类筛选、多选安装 |
| **广播** | 事件广播和通知管理 |
| **设置** | 系统配置、偏好设置、审计日志、提示词模板、API Key 管理（AES-256-GCM 加密） |

---

## 功能速查

| 功能 | 在哪里 | 能干什么 |
|------|--------|---------|
| 创建 Agent | 智能体 → 创建智能体 | 配置 AI 助手 |
| 执行任务 | 任务 → 创建任务 | 选择 Agent 或工作流执行，实时查看输出 |
| 编排工作流 | 工作流 → 创建工作流 | 多 Agent 串联协作 |
| 浏览文件 | 文件 | 管理项目文件 |
| 网页终端 | 终端 → 新建会话 | 在浏览器里敲命令行 |
| AI 对话 | 对话 → 新建对话 | 和 AI 聊天 |
| 知识库 | 知识库 → 新建条目 | 给 AI 提供参考资料 |
| 历史记录 | 历史 | 查看以往执行记录 |
| 成果库 | 成果库 | 查看 AI 生成的所有文件 |
| 技能市场 | 市场 | 安装新技能扩展 Agent 能力 |
| 工作流模板 | 市场 → 工作流模板 | 使用预设的流程模板 |

---

## 智能体配置

| 配置项 | 说明 |
|--------|------|
| 模型 | opus（最强推理）/ sonnet（平衡）/ haiku（快速轻量）— CLI 别名，通过 ccswitch 映射实际模型 |
| 系统提示词 | 定义 Agent 行为方式 |
| 温度 | 控制输出随机性（0-1） |
| 工具权限 | 读文件、写文件、执行命令等 |
| 角色预设 | 开发者、审查员、测试员、规划师、调试员、文档员、自定义 |

---

## 工作区管理

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
│   ├── checkpoints/    # 每步检查点文件
│   └── snapshots/      # 快照
├── reports/            # 执行报告
├── .context/           # 工作流记忆
│   ├── {workflow-id}.md
│   └── shared/
│       └── pool.json
└── .BACKUP/            # 自动备份（崩溃恢复用）
```

- 切换工作区时自动加载对应数据
- 服务器重启时恢复 `current-workspace.json` 中记录的工作区
- 全局数据（任务、队列、智能体）在 `data/` 目录，不受工作区切换影响
- 备份/迁移：直接复制 `data/` + `workspace/` 两个目录即可

---

## 数据存储

### `data/` 目录（全局数据）

| 文件 | 说明 |
|------|------|
| `app.db` | SQLite 主数据库（sql.js WASM，首次启动自动从 JSON 迁移） |
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
| `chat-workspace/` | 对话隔离工作区（不含 CLAUDE.md） |

---

## 安全与鉴权

### 多层防护

- **API Key 鉴权**：首次启动自动生成，AES-256-GCM 加密存储。HTTP 通过 `X-API-Key` 头，WebSocket 通过 `?api_key=` 查询参数
- **三层限流**：全局 600 次/分钟、写操作 200 次/10 秒、鉴权 10 次/分钟
- **工作区沙箱**：`--permission-mode acceptEdits` 限制工作区内写入
- **路径穿越防护**：所有文件路径通过 resolvePath 校验
- **Agent 内存沙箱**：每 10 秒监测 RSS，超过 2GB 自动终止进程
- **工具白名单**：Edit/Write（限工作区）、Read、Bash（仅读命令）、WebSearch/Fetch、Agent、Glob/Grep
- **日志持久化**：`logs/app-YYYY-MM-DD.log` 每日轮转，自动清理 30 天前日志

---

## 工作保护机制

### 三层防护体系

| 层级 | 机制 | 说明 |
|------|------|------|
| **执行中** | 9种错误分类 + 自适应退避 + 模型降级 + 输入截断 + 断路器 | 自动修复，防 Token 浪费 |
| **关闭时** | 6个 Model 同步 flush + Workspace 状态 flush + 文件监听器清理 | 优雅关闭，数据不丢 |
| **重启后** | 检查点检测 + interrupted 标记 + 记忆注入 + 续传执行 | 从断点恢复 |

### 错误分类与自适应重试

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

### 检查点与恢复

- **节点级检查点**：每个节点执行完立即 `writeFileSync` 同步落盘，失败前也保存
- **断点恢复**：重启后自动检测检查点 → 标记 `interrupted` → 显示「续传」按钮 → 已完成节点跳过
- **暂停恢复**：abortSignal 即时暂停（< 5 秒），恢复使用检查点
- **记忆注入**：续传时自动注入已保存的工作流记忆

---

## 性能优化

| 优化项 | 说明 |
|--------|------|
| 分页懒加载 | 列表默认加载 20 条，点击"加载更多"获取下一页 |
| WebSocket 自动重连 | 指数退避（最大 30 秒），最多 10 次 |
| 重连后状态同步 | 重连后自动刷新各页面数据 |
| 客户端缓存 | `Cache` 工具类，支持 TTL（默认 5 分钟） |
| 消息节流 | 仪表盘 2 秒，任务/Agent 列表 500 毫秒 |
| CPU 实时采样 | 两次采样（500ms 间隔）计算真实使用率 |
| 终端会话上限 | 最多 10 个并发终端会话 |
| 异步持久化 | 写入队列串行化，不阻塞事件循环 |
| 字体自适应 | 视口对角线连续缩放，60ms debounce，70%~100% 范围 |
| 侧边栏自动折叠 | 880px 以下折叠图标模式，30% 屏幕宽度以下浮层覆盖 |

---

## 测试

```bash
npm test              # 运行后端测试
```

测试结构：

```
tests/
├── server/          # 后端测试（API、模型、服务层、集成）
└── frontend/        # 前端测试（工具函数、API 客户端、组件）
```

---

## API 概览

统一响应格式：
```json
{ "success": true, "data": { ... }, "meta": { "total": 100, "page": 1, "limit": 20 } }
```

| 模块 | 端点 | 说明 |
|------|------|------|
| 智能体 | `/api/agents` | CRUD + 批量删除 |
| 工作流 | `/api/workflows` | CRUD + 执行 + 快照 + 统计 + 时间线 + AI创建 + 流程图导入 + 导出/导入 + 批量克隆 + 重命名 + 跳过失败节点 |
| 任务 | `/api/tasks` | CRUD + 批量删除 |
| 任务队列 | `/api/task-queues` | 批量任务队列管理 |
| 文件 | `/api/files` | 浏览 + 读写 + 工作区切换 |
| 知识库 | `/api/knowledge` | CRUD + 搜索 + 标签 + 导入/导出(JSON/CSV/Markdown) |
| 记忆 | `/api/memory` | 读写 + 搜索 + 共享池（按工作流维度） |
| 成果 | `/api/artifacts` | 索引 + 搜索 + 预览 + 删除 |
| 报告 | `/api/reports` | 查看执行报告 |
| 对话 | `/api/chat` | 会话管理 + 搜索 |
| 终端 | `/api/terminal` | 终端会话 + 历史 + 恢复 + 调整大小 |
| 技能 | `/api/skills` | 安装 + 卸载 + 已安装列表 |
| 历史 | `/api/history` | 执行历史 + 批量删除 |
| MCP | `/api/mcp-tools` | MCP 工具管理 |
| 提示词 | `/api/prompt-templates` | 提示词模板 CRUD |
| 广播 | `/api/broadcast` | 事件广播 |
| 安全 | `/api/safety` | 安全审计 |
| 鉴权 | `/api/auth/key` | 获取 API Key |
| 健康 | `/api/health` | 服务状态 + Claude CLI 兼容性 |

---

## 常见问题

**Q: Agent 执行失败怎么办？**
- 检查 Claude Code CLI 是否安装：命令行输入 `claude --version`
- 检查 API 是否已配置：命令行输入 `claude` 看是否能正常启动
- 子 Agent 在 CLI 不可用时自动回退到 SDK 模式

**Q: 工作流执行到一半断了怎么办？**
- 工作流支持断点续传，重启服务后会自动检测检查点并标记为 interrupted
- 在「工作流」页面找到中断的工作流，点击「续传」

**Q: 数据会丢吗？**
- 每 2 秒自动保存一次，正常关闭不会丢数据
- 即使突然断电，最多丢 2 秒的数据

**Q: 能同时管理多个项目吗？**
- 可以。点左侧「文件」→「切换工作区」，可以创建/切换多个独立工作区

**Q: Agent 会不会操作到项目外的文件？**
- 不会。所有 Agent 被限制在工作区目录内，无法访问系统文件

---

## 常用命令

```bash
npm start              # 启动服务器
npm run dev            # 开发模式（自动重启）
npm test               # 运行测试
```

## 批处理脚本

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

## 目录结构

```
my-project/
├── src/
│   ├── server/          # 后端代码
│   │   ├── app.js       # Express 应用
│   │   ├── routes/      # API 路由
│   │   ├── services/    # 业务逻辑
│   │   ├── models/      # 数据模型
│   │   └── middleware/  # 中间件
│   └── client/          # 前端代码
│       ├── index.html   # SPA 入口
│       ├── icons.svg    # SVG 图标 sprite（40+ 图标）
│       ├── js/          # JavaScript
│       │   ├── pages/   # 页面组件
│       │   └── components/ # 通用组件
│       └── css/         # 样式（5 个）
├── workspace/           # 默认工作区
├── data/                # 全局数据
│   ├── app.db           # SQLite 主数据库
│   ├── agents.json      # 智能体配置
│   ├── tasks.json       # 全局任务数据
│   ├── task-queues.json # 全局任务队列
│   ├── api-key.json     # API Key（AES-256-GCM 加密）
│   ├── audit-logs.json  # 操作审计日志
│   ├── skills/          # 已安装技能状态
│   ├── mcp/             # MCP 工具配置
│   └── chat-workspace/  # 对话隔离工作区
├── tests/               # 测试文件
│   ├── server/          # 后端测试
│   └── frontend/        # 前端测试
├── docs/
│   └── architecture.md  # 深度技术文档（执行引擎、记忆系统、安全机制等）
├── install.bat          # 一键安装脚本
├── start.bat            # 启动脚本
├── stop.bat             # 停止脚本
├── restart.bat          # 重启脚本
├── logs.bat             # 查看日志
├── add-to-startup.bat   # 添加开机自启
├── remove-from-startup.bat # 取消开机自启
├── README.md           # 中文文档（本文件）
└── README_EN.md        # 英文文档
```

---

> 深度技术文档（执行引擎内部机制、双引擎模型、命名 Agent 工具、检查点系统、WebSocket 协议等）请参考 [docs/architecture.md](docs/architecture.md)。
