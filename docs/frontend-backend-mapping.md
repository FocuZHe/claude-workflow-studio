# Claude Workflow Studio — 前端功能与后端映射文档

## 目录

1. [架构概述](#1-架构概述)
2. [页面功能与按钮映射](#2-页面功能与按钮映射)
3. [API端点完整列表](#3-api端点完整列表)
4. [WebSocket事件](#4-websocket事件)
5. [数据存储](#5-数据存储)
6. [认证机制](#6-认证机制)
7. [关键架构特点](#7-关键架构特点)

---

## 1. 架构概述

```
┌─────────────────────────────────────────────────────────────┐
│                    前端架构                                   │
├─────────────────────────────────────────────────────────────┤
│ 技术栈：Vanilla JavaScript SPA + Hash Router                │
│ 状态管理：Store (内存) + localStorage                       │
│ 通信：REST API + WebSocket                                  │
│ 组件：组件化页面 + 全局工具                                  │
│ 按钮总数：357个 click 事件处理                               │
└─────────────────────────────────────────────────────────────┘
```

### 核心文件结构

```
src/client/
├── js/
│   ├── api.js              # API 客户端（396行，定义所有API调用）
│   ├── ws.js               # WebSocket 客户端（214行）
│   ├── store.js            # 状态管理
│   ├── router.js           # 路由
│   ├── app.js              # 应用入口
│   ├── components/         # 15个通用组件
│   └── pages/              # 32个页面组件
└── css/                    # 样式文件
```

---

## 2. 页面功能与按钮映射

### 2.1 控制面板 (DashboardPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 资源刷新按钮 | click | `loadResources()` | `GET /api/resources`, `GET /api/resources/agents` |

**WebSocket 监听：**
- `task.completed` → `loadStats()` (节流2秒)
- `task.failed` → `loadStats()`
- `task.progress` → `loadStats()`
- `workflow.statusUpdate` → `loadStats()`
- `workflow.nodeUpdate` → `loadStats()`
- `agent.statusUpdate` → `loadStats()`
- `chat.titleUpdated` → `loadStats()`

---

### 2.2 Agent管理 (AgentsPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 创建Agent按钮 | click | `openCreateModal()` | - |
| 批量选择按钮 | click | `toggleSelectionMode()` | - |
| 空状态创建按钮 | click | `openCreateModal()` | - |
| 编辑按钮 (.btn-edit) | click | `openEditModal(id)` | - |
| 删除按钮 (.btn-delete) | click | `deleteAgent(id)` | `DELETE /api/agents/:id` |
| Agent卡片 | click | `openDetail(id)` | `GET /api/agents/:id` |
| 批量删除 | click | `batchDelete()` | `DELETE /api/agents/batch` |

**AgentCreate.js:**
| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 提交按钮 | click | `createAgent()` | `POST /api/agents` |

**AgentDetail.js:**
| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 保存按钮 | click | `saveAgent()` | `PUT /api/agents/:id` |

---

### 2.3 工作流管理 (WorkflowsPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 创建工作流 | click | `createWorkflow()` | `POST /api/workflows` |
| 导出选中 | click | `exportSelectedWorkflows()` | `POST /api/workflows/export` |
| 导入工作流 | click | `importWorkflowsFromFile()` | `POST /api/workflows/import` |
| AI创建 | click | `createWorkflowFromNL()` | `POST /api/workflows/create-from-text` |
| 批量选择 | click | `toggleSelectionMode()` | - |
| 列表视图 | click | 切换到列表模式 | - |
| 构建器视图 | click | 切换到构建器模式 | - |
| 编辑按钮 | click | `editWorkflow(id)` | - |
| 重命名按钮 | click | `renameWorkflow(id)` | `PUT /api/workflows/:id/rename` |
| 删除按钮 | click | `deleteWorkflow(id)` | `DELETE /api/workflows/:id` |
| 查看状态 | click | `viewWorkflowStatus(id)` | `GET /api/workflows/:id/status` |
| 执行按钮 | click | `executeWorkflow(id)` | `POST /api/workflows/:id/execute` |
| 批量删除 | click | `batchDelete()` | `DELETE /api/workflows/batch` |
| 工作区选择 | click | `switchWorkspace()` | `POST /api/files/set-workspace` |
| 记忆设置 | click | `openMemorySettings()` | - |
| 知识设置 | click | `openKnowledgeSettings()` | - |
| 运行工作流 | click | `runWorkflow()` | `POST /api/workflows/:id/execute` |
| 跳过节点 | click | `skipNode()` | `POST /api/workflows/:id/skip-node` |
| 恢复检查点 | click | `resumeFromCheckpoint()` | `POST /api/workflows/:id/resume-from-checkpoint` |
| 选择文件夹 | click | `selectWorkflowFolder()` | `GET /api/files/browse` |
| NL创建确认 | click | `createWorkflowFromNL()` | `POST /api/workflows/create-from-text` |
| 导入确认 | click | `importWorkflows()` | `POST /api/workflows/import` |

**WorkflowCanvas.js (构建器):**
| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 快照保存 | click | `saveSnapshot()` | `POST /api/workflows/:id/snapshots` |
| 快照列表 | click | `showSnapshotList()` | `GET /api/workflows/:id/snapshots` |
| 聚焦模式 | click | `toggleFocusMode()` | - |
| 关闭详情 | click | `hideNodeDetail()` | - |
| 保存条件配置 | click | `saveConditionConfig()` | `PUT /api/workflows/:id` |
| 保存子工作流配置 | click | `saveSubworkflowConfig()` | `PUT /api/workflows/:id` |
| 保存Agent配置 | click | `saveAgentPrompt()` | `PUT /api/workflows/:id` |
| 添加节点确认 | click | `addNode()` | `PUT /api/workflows/:id` |
| 选择工作流 | click | `pickWorkflowAndInline()` | `GET /api/workflows/list-for-selection` |
| 删除节点 | click | `deleteNode()` | `PUT /api/workflows/:id` |
| 取消删除 | click | `hideDeleteToolbar()` | - |
| 边标签确认 | click | `saveEdgeLabel()` | `PUT /api/workflows/:id` |
| 测试节点确认 | click | `testNode()` | `POST /api/workflows/:id/test-node` |
| 保存记忆设置 | click | `saveMemorySettings()` | `PUT /api/workflows/:id` |
| 保存知识设置 | click | `saveKnowledgeSettings()` | `PUT /api/workflows/:id` |

**WebSocket 监听：**
- `workflow.statusUpdate` → 更新节点状态
- `workflow.nodeUpdate` → 更新节点状态
- `workflow.approvalRequested` → 显示审批对话框
- `files.generated` → 显示文件生成通知

---

### 2.4 任务管理 (TasksPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 创建任务 | click | `openCreateModal()` | - |
| 批量选择 | click | `toggleSelectionMode()` | - |
| 执行按钮 | click | `executeTask(id)` | `POST /api/tasks/:id/execute` |
| 暂停按钮 | click | `pauseTask(id)` | `POST /api/tasks/:id/pause` |
| 恢复按钮 | click | `resumeTask(id)` | `POST /api/tasks/:id/resume` |
| 取消按钮 | click | `cancelTask(id)` | `POST /api/tasks/:id/cancel` |
| 删除按钮 | click | `deleteTask(id)` | `DELETE /api/tasks/:id` |
| 任务卡片 | click | `openDetailModal(id)` | `GET /api/tasks/:id` |
| 批量删除 | click | `batchDelete()` | `DELETE /api/tasks/batch` |

**TaskCreate.js:**
| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 浏览文件夹 | click | `browseFolder()` | `GET /api/files/browse` |
| 添加批量项 | click | `addBatchItem()` | - |
| 提交按钮 | click | `createTask()` | `POST /api/tasks` |

**WebSocket 监听：**
- `task.completed` → Toast通知
- `task.failed` → Toast通知

---

### 2.5 对话 (ChatPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 新建对话 | click | `createSession()` | `POST /api/chat` |
| 归档对话 | click | `archiveCurrentSession()` | `POST /api/chat/:id/archive` |
| 发送消息 | click | `sendMessage()` | `POST /api/chat/:id/messages` |
| 会话列表项 | click | `switchSession(id)` | `GET /api/chat/:id` |
| 斜杠命令 | click | `selectSlashCommand(cmd)` | - |
| 标题双击 | dblclick | 编辑标题 | `PUT /api/chat/:id` |

**WebSocket 监听：**
- `chat.stream` → 流式消息显示

---

### 2.6 文件管理 (FilesPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 新建工作区 | click | `createWorkspace()` | `POST /api/files/workspace` |
| 新建文件 | click | `createFile()` | `POST /api/files/write` |
| 新建文件夹 | click | `createFolder()` | `POST /api/files/mkdir` |
| 保存文件 | click | `saveFile()` | `POST /api/files/write` |
| 切换工作区 | click | `switchWorkspace()` | `POST /api/files/set-workspace` |
| 导入文件 | click | `openImportDialog()` | `POST /api/files/import` |
| 返回按钮 | click | `navigateBack()` | - |
| 撤销按钮 | click | `performUndo()` | `GET /api/files/undo-cache` |
| 重做按钮 | click | `performRedo()` | - |
| 差异视图 | click | `toggleDiffView()` | - |
| 工作区切换按钮 | click | `switchWorkspace()` | `POST /api/files/set-workspace` |
| 进入工作区 | click | `enterWorkspace()` | `POST /api/files/set-workspace` |
| 停用工作区 | click | `deactivateWorkspace()` | `DELETE /api/workspaces/:id` |

---

### 2.7 终端 (TerminalPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 新建终端 | click | `createSession()` | `POST /api/terminal` |
| 清除输出 | click | `clearOutput()` | - |
| 历史记录 | click | `showTerminalHistory()` | `GET /api/terminal/:id/history` |
| 会话列表项 | click | `switchSession(id)` | - |
| 关闭会话 | click | `closeSession(id)` | `DELETE /api/terminal/:id` |

---

### 2.8 设置 (SettingsPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 保存设置 | click | `saveSettings()` | `PUT /api/api-keys/:id` |
| 刷新审计日志 | click | `loadAuditLogs()` | `GET /api/audit-logs` |
| 添加配置 | click | `showConfigModal()` | - |
| 测试连接 | click | `testConnection()` | `GET /api/api-keys/:id/test` |
| 设为默认 | click | `setDefault()` | `PUT /api/api-keys/:id/default` |
| 删除配置 | click | `deleteConfig()` | `DELETE /api/api-keys/:id` |
| 显示密钥 | click | `toggleKeyVisibility()` | - |
| 保存配置 | click | `saveConfig()` | `POST /api/api-keys` 或 `PUT /api/api-keys/:id` |

---

### 2.9 工作流模板 (WorkflowTemplates)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 克隆模板 | click | `cloneTemplate(id)` | `POST /api/workflow-templates/:id/clone` |

---

### 2.10 技能市场 (SkillsMarket)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 安装技能 | click | `installSkill()` | `POST /api/skills/:id/install` |
| 卸载技能 | click | `uninstallSkill()` | `DELETE /api/skills/:id/uninstall` |
| 详情按钮 | click | `showDetail()` | - |

---

### 2.11 知识库 (KnowledgePage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 添加条目 | click | `addEntry()` | `POST /api/knowledge` |
| 导出按钮 | click | `showExportDialog()` | `GET /api/knowledge/export` |
| 导入按钮 | click | `showImportDialog()` | `POST /api/knowledge/import` |
| 保存按钮 | click | `saveEntry()` | `PUT /api/knowledge/:id` |
| 删除按钮 | click | `deleteEntry()` | `DELETE /api/knowledge/:id` |
| 条目卡片 | click | `viewEntry(id)` | `GET /api/knowledge/:id` |

---

### 2.12 记忆管理 (MemoryPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 刷新按钮 | click | `loadMemories()` | `GET /api/memory/list` |
| 搜索按钮 | click | `searchMemories()` | `GET /api/memory/search` |
| 记忆卡片 | click | `viewMemory(workflowId)` | `GET /api/memory/:workflowId` |
| 删除按钮 | click | `deleteMemory()` | `DELETE /api/memory/:workflowId` |

---

### 2.13 广播 (BroadcastPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 发送广播 | click | `sendBroadcast()` | `POST /api/broadcast` |
| 刷新历史 | click | `loadHistory()` | `GET /api/broadcast/history` |
| 暂停按钮 | click | `togglePause()` | - |
| 清除按钮 | click | `clearEvents()` | - |

---

### 2.14 任务队列 (TaskQueuePage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 创建队列 | click | `openCreateModal()` | - |
| 启动按钮 | click | `startQueue(id)` | `POST /api/task-queues/:id/start` |
| 暂停按钮 | click | `pauseQueue(id)` | `POST /api/task-queues/:id/pause` |
| 恢复按钮 | click | `resumeQueue(id)` | `POST /api/task-queues/:id/resume` |
| 取消按钮 | click | `cancelQueue(id)` | `POST /api/task-queues/:id/cancel` |
| 删除按钮 | click | `deleteQueue(id)` | `DELETE /api/task-queues/:id` |
| 队列卡片 | click | `openDetail(id)` | `GET /api/task-queues/:id` |

---

### 2.15 历史记录 (HistoryPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 刷新按钮 | click | `loadHistory()` | `GET /api/history` |
| 批量选择 | click | `toggleSelectionMode()` | - |
| 查看详情 | click | `showDetail(runId)` | `GET /api/history/:runId` |
| 删除按钮 | click | `deleteSingleHistory(runId)` | `DELETE /api/history/:runId` |
| 批量删除 | click | `batchDelete()` | `DELETE /api/history/batch` |
| 取消批量 | click | `cancelBatch()` | - |

---

### 2.16 报告 (ReportsPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 刷新按钮 | click | `loadReports()` | `GET /api/reports` |
| 生成报告 | click | `openGenerateModal()` | `POST /api/reports/generate` |
| 下载按钮 | click | `downloadReport()` | `GET /api/reports/:id/download` |
| 删除按钮 | click | `deleteReport()` | `DELETE /api/reports/:id` |
| 查看按钮 | click | `viewReport()` | `GET /api/reports/:id` |

---

### 2.17 工作区管理 (WorkspacesPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 激活工作区 | click | `activateWorkspace()` | `POST /api/workspaces` |
| 停用工作区 | click | `deactivateWorkspace()` | `DELETE /api/workspaces/:id` |
| 切换工作区 | click | `switchWorkspace()` | `POST /api/files/set-workspace` |

---

### 2.18 分析 (AnalyticsPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 刷新按钮 | click | `loadAnalytics()` | `GET /api/workflows/statistics` |
| 批量选择 | click | `toggleSelectionMode()` | - |
| 批量删除 | click | `batchDelete()` | `POST /api/workflows/execution-logs/batch-delete` |

---

### 2.19 工件 (ArtifactsPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 重建索引 | click | `reindex()` | `POST /api/artifacts/reindex` |
| 批量选择 | click | `toggleSelectionMode()` | - |
| 批量删除 | click | `batchDelete()` | `DELETE /api/artifacts/:id` |
| 工件卡片 | click | `previewArtifact(id)` | `GET /api/artifacts/:id/content` |
| 删除按钮 | click | `deleteArtifact(id)` | `DELETE /api/artifacts/:id` |

---

### 2.20 安全 (SafetyPage)

| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 刷新统计 | click | `loadStats()` | - |
| 刷新威胁 | click | `loadThreats()` | - |
| 添加规则 | click | `openRuleForm()` | - |
| 保存规则 | click | `saveRule()` | - |
| 编辑规则 | click | `editRule()` | - |
| 删除规则 | click | `deleteRule()` | - |

---

### 2.21 组件级功能

**Navbar.js:**
| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 工作区切换 | click | `switchToWorkspace()` | `POST /api/files/set-workspace` |
| 主题切换 | click | `toggleTheme()` | - |
| 命令提示 | click | `showCommandPalette()` | - |
| 工作区计数 | click | `showWorkspaces()` | - |

**TerminalPanel.js:**
| 按钮/元素 | 事件 | 调用函数 | API调用 |
|-----------|------|----------|---------|
| 新建终端 | click | `createTerminal()` | `POST /api/terminal` |
| 关闭终端 | click | `closeTerminal()` | `DELETE /api/terminal/:id` |

### 2.1 控制面板 (DashboardPage)

| 功能 | API 调用 | 后端路由 | 后端服务 |
|------|----------|----------|----------|
| 统计数据 | `GET /api/workflows/statistics` | `routes/workflows.ts` | `WorkflowService` |
| 系统资源 | `GET /api/resources` | `routes/resources.ts` | `ResourceService` |
| Agent进程 | `GET /api/resources/agents` | `routes/resources.ts` | `ResourceService` |
| 最近活动 | `GET /api/history` | `routes/history.ts` | `HistoryService` |

**WebSocket 监听：**
- `task.completed` → 刷新统计
- `task.failed` → 刷新统计
- `workflow.statusUpdate` → 刷新统计
- `agent.statusUpdate` → 刷新统计

---

### 2.2 Agent管理 (AgentsPage)

| 功能 | API 调用 | 后端路由 | 后端服务 |
|------|----------|----------|----------|
| 列表 | `GET /api/agents` | `routes/agents.ts` | `AgentService` |
| 详情 | `GET /api/agents/:id` | `routes/agents.ts` | `AgentService` |
| 创建 | `POST /api/agents` | `routes/agents.ts` | `AgentService` |
| 更新 | `PUT /api/agents/:id` | `routes/agents.ts` | `AgentService` |
| 删除 | `DELETE /api/agents/:id` | `routes/agents.ts` | `AgentService` |
| 日志 | `GET /api/agents/:id/logs` | `routes/agents.ts` | `AgentService` |
| 子Agent | `GET /api/agents/:id/children` | `routes/agents.ts` | `AgentService` |
| 批量删除 | `DELETE /api/agents/batch` | `routes/agents.ts` | `AgentService` |

---

### 2.3 工作流管理 (WorkflowsPage + WorkflowCanvas)

| 功能 | API 调用 | 后端路由 | 后端服务 |
|------|----------|----------|----------|
| 列表 | `GET /api/workflows` | `routes/workflows.ts` | `WorkflowService` |
| 详情 | `GET /api/workflows/:id` | `routes/workflows.ts` | `WorkflowService` |
| 创建 | `POST /api/workflows` | `routes/workflows.ts` | `WorkflowService` |
| 更新 | `PUT /api/workflows/:id` | `routes/workflows.ts` | `WorkflowService` |
| 删除 | `DELETE /api/workflows/:id` | `routes/workflows.ts` | `WorkflowService` |
| 执行 | `POST /api/workflows/:id/execute` | `routes/workflows.ts` | `WorkflowService` |
| 暂停 | `POST /api/workflows/:id/pause` | `routes/workflows.ts` | `WorkflowService` |
| 恢复 | `POST /api/workflows/:id/resume` | `routes/workflows.ts` | `WorkflowService` |
| 停止 | `POST /api/workflows/:id/stop` | `routes/workflows.ts` | `WorkflowService` |
| AI创建 | `POST /api/workflows/create-from-text` | `routes/workflows.ts` | `SdkService` |
| 批量执行 | `POST /api/workflows/batch-execute` | `routes/workflows.ts` | `WorkflowService` |
| 快照保存 | `POST /api/workflows/:id/snapshots` | `routes/workflows.ts` | `SnapshotService` |
| 快照恢复 | `POST /api/workflows/:id/snapshots/:sid/restore` | `routes/workflows.ts` | `SnapshotService` |
| 检查点恢复 | `POST /api/workflows/:id/resume-from-checkpoint` | `routes/workflows.ts` | `WorkflowService` |

**WebSocket 监听：**
- `workflow.statusUpdate` → 工作流状态更新
- `workflow.nodeUpdate` → 节点状态更新
- `workflow.approvalRequested` → 审批请求
- `files.generated` → 文件生成通知

---

### 2.4 任务管理 (TasksPage)

| 功能 | API 调用 | 后端路由 | 后端服务 |
|------|----------|----------|----------|
| 列表 | `GET /api/tasks` | `routes/tasks.ts` | `TaskService` |
| 详情 | `GET /api/tasks/:id` | `routes/tasks.ts` | `TaskService` |
| 创建 | `POST /api/tasks` | `routes/tasks.ts` | `TaskService` |
| 更新 | `PUT /api/tasks/:id` | `routes/tasks.ts` | `TaskService` |
| 删除 | `DELETE /api/tasks/:id` | `routes/tasks.ts` | `TaskService` |
| 执行 | `POST /api/tasks/:id/execute` | `routes/tasks.ts` | `TaskService` |
| 取消 | `POST /api/tasks/:id/cancel` | `routes/tasks.ts` | `TaskService` |

**WebSocket 监听：**
- `task.completed` → 任务完成
- `task.failed` → 任务失败
- `task.progress` → 任务进度

---

### 2.5 对话 (ChatPage)

| 功能 | API 调用 | 后端路由 | 后端服务 |
|------|----------|----------|----------|
| 会话列表 | `GET /api/chat` | `routes/chat.ts` | `ChatService` |
| 创建会话 | `POST /api/chat` | `routes/chat.ts` | `ChatService` |
| 发送消息 | `POST /api/chat/:id/messages` | `routes/chat.ts` | `ChatService` |
| 删除会话 | `DELETE /api/chat/:id` | `routes/chat.ts` | `ChatService` |
| 搜索 | `GET /api/chat/search` | `routes/chat.ts` | `ChatService` |
| 归档 | `POST /api/chat/:id/archive` | `routes/chat.ts` | `ChatService` |

**WebSocket 监听：**
- `chat.stream` → 流式消息（实时输出）

---

### 2.6 文件管理 (FilesPage + FileTree)

| 功能 | API 调用 | 后端路由 | 后端服务 |
|------|----------|----------|----------|
| 列表 | `GET /api/files` | `routes/files.ts` | `FileService` |
| 读取 | `GET /api/files/read` | `routes/files.ts` | `FileService` |
| 写入 | `POST /api/files/write` | `routes/files.ts` | `FileService` |
| 创建目录 | `POST /api/files/mkdir` | `routes/files.ts` | `FileService` |
| 删除 | `DELETE /api/files` | `routes/files.ts` | `FileService` |
| 重命名 | `POST /api/files/rename` | `routes/files.ts` | `FileService` |
| 浏览目录 | `GET /api/files/browse` | `routes/files.ts` | `FileService` |
| 设置工作区 | `POST /api/files/set-workspace` | `routes/files.ts` | `FileService` |
| 工作区信息 | `GET /api/files/workspace-info` | `routes/files.ts` | `FileService` |

---

### 2.7 工作区管理 (WorkspacesPage)

| 功能 | API 调用 | 后端路由 | 后端服务 |
|------|----------|----------|----------|
| 列表 | `GET /api/workspaces` | `routes/workspaces.ts` | `WorkspaceManager` |
| 激活 | `POST /api/workspaces` | `routes/workspaces.ts` | `WorkspaceManager` |
| 停用 | `DELETE /api/workspaces/:id` | `routes/workspaces.ts` | `WorkspaceManager` |
| 状态 | `GET /api/workspaces/:id/state` | `routes/workspaces.ts` | `WorkspaceManager` |
| 工作流 | `GET /api/workspaces/:id/workflows` | `routes/workspaces.ts` | `WorkspaceManager` |

**持久化：** `data/active-workspaces.json`

---

### 2.8 终端 (TerminalPage)

| 功能 | API 调用 | 后端路由 | 后端服务 |
|------|----------|----------|----------|
| 创建 | `POST /api/terminal` | `routes/terminal.ts` | `TerminalService` |
| 列表 | `GET /api/terminal` | `routes/terminal.ts` | `TerminalService` |
| 输入 | `POST /api/terminal/:id/input` | `routes/terminal.ts` | `TerminalService` |
| 输出 | `GET /api/terminal/:id/output` | `routes/terminal.ts` | `TerminalService` |
| 调整大小 | `POST /api/terminal/:id/resize` | `routes/terminal.ts` | `TerminalService` |
| 关闭 | `DELETE /api/terminal/:id` | `routes/terminal.ts` | `TerminalService` |

---

### 2.9 设置 (SettingsPage)

| 功能 | API 调用 | 后端路由 | 后端服务 |
|------|----------|----------|----------|
| API密钥列表 | `GET /api/api-keys` | `routes/api-keys.ts` | `ApiKeyService` |
| 创建配置 | `POST /api/api-keys` | `routes/api-keys.ts` | `ApiKeyService` |
| 更新配置 | `PUT /api/api-keys/:id` | `routes/api-keys.ts` | `ApiKeyService` |
| 删除配置 | `DELETE /api/api-keys/:id` | `routes/api-keys.ts` | `ApiKeyService` |
| 测试连接 | `GET /api/api-keys/:id/test` | `routes/api-keys.ts` | `ApiKeyService` |
| 审计日志 | `GET /api/audit-logs` | `routes/audit.ts` | `AuditService` |

---

### 2.10 知识库 (KnowledgePage)

| 功能 | API 调用 | 后端路由 | 后端服务 |
|------|----------|----------|----------|
| 搜索 | `GET /api/knowledge` | `routes/knowledge.ts` | `KnowledgeService` |
| 添加 | `POST /api/knowledge` | `routes/knowledge.ts` | `KnowledgeService` |
| 更新 | `PUT /api/knowledge/:id` | `routes/knowledge.ts` | `KnowledgeService` |
| 删除 | `DELETE /api/knowledge/:id` | `routes/knowledge.ts` | `KnowledgeService` |
| 标签 | `GET /api/knowledge/tags` | `routes/knowledge.ts` | `KnowledgeService` |

---

### 2.11 记忆 (MemoryPage)

| 功能 | API 调用 | 后端路由 | 后端服务 |
|------|----------|----------|----------|
| 搜索 | `GET /api/memory/search` | `routes/memory.ts` | `MemoryService` |
| 获取 | `GET /api/memory/:workflowId` | `routes/memory.ts` | `MemoryService` |
| 更新 | `PUT /api/memory/:workflowId` | `routes/memory.ts` | `MemoryService` |
| 删除 | `DELETE /api/memory/:workflowId` | `routes/memory.ts` | `MemoryService` |
| 共享池 | `GET /api/memory/shared/pool` | `routes/memory.ts` | `MemoryService` |

---

### 2.12 广播 (BroadcastPage)

| 功能 | API 调用 | 后端路由 | 后端服务 |
|------|----------|----------|----------|
| 发送广播 | `POST /api/broadcast` | `routes/broadcast.ts` | `BroadcastService` |
| 历史 | `GET /api/broadcast/history` | `routes/broadcast.ts` | `BroadcastService` |
| 客户端 | `GET /api/clients` | `routes/clients.ts` | `BroadcastService` |

---

### 2.13 Git (集成在FilesPage)

| 功能 | API 调用 | 后端路由 | 后端服务 |
|------|----------|----------|----------|
| 状态 | `GET /api/git/status` | `routes/git.ts` | `GitService` |
| 差异 | `GET /api/git/diff` | `routes/git.ts` | `GitService` |
| 日志 | `GET /api/git/log` | `routes/git.ts` | `GitService` |
| 提交 | `POST /api/git/commit` | `routes/git.ts` | `GitService` |
| 分支 | `GET /api/git/branches` | `routes/git.ts` | `GitService` |

---

### 2.14 技能市场 (SkillsMarket)

| 功能 | API 调用 | 后端路由 | 后端服务 |
|------|----------|----------|----------|
| 列表 | `GET /api/skills` | `routes/skills.ts` | `SkillService` |
| 安装 | `POST /api/skills/:id/install` | `routes/skills.ts` | `SkillService` |
| 卸载 | `DELETE /api/skills/:id/uninstall` | `routes/skills.ts` | `SkillService` |
| 已安装 | `GET /api/skills/installed` | `routes/skills.ts` | `SkillService` |

---

## 3. API端点完整列表

### 3.1 Agent管理
```
GET    /api/agents                    # 列表
GET    /api/agents/:id                # 详情
GET    /api/agents/:id/children       # 子Agent
POST   /api/agents                    # 创建
PUT    /api/agents/:id                # 更新
DELETE /api/agents/:id                # 删除
GET    /api/agents/:id/logs           # 日志
DELETE /api/agents/batch              # 批量删除
```

### 3.2 工作流管理
```
GET    /api/workflows                 # 列表
GET    /api/workflows/:id             # 详情
POST   /api/workflows                 # 创建
PUT    /api/workflows/:id             # 更新
DELETE /api/workflows/:id             # 删除
PUT    /api/workflows/:id/rename      # 重命名
POST   /api/workflows/:id/execute     # 执行
POST   /api/workflows/:id/pause       # 暂停
POST   /api/workflows/:id/resume      # 恢复
POST   /api/workflows/:id/stop        # 停止
POST   /api/workflows/:id/skip-node   # 跳过节点
GET    /api/workflows/:id/status      # 状态
GET    /api/workflows/:id/execution   # 执行详情
PUT    /api/workflows/:id/folder      # 设置文件夹
GET    /api/workflows/:id/runs/:rid/node-logs  # 节点日志
POST   /api/workflows/create-from-text         # AI创建
POST   /api/workflows/create-in-all            # 在所有工作区创建
POST   /api/workflows/batch-execute            # 批量执行
POST   /api/workflows/batch-clone              # 批量克隆
POST   /api/workflows/export                   # 导出
POST   /api/workflows/import                   # 导入
POST   /api/workflows/import-md                # 导入MD
GET    /api/workflows/list-for-selection       # 选择列表
GET    /api/workflows/statistics               # 统计
GET    /api/workflows/timeline                 # 时间线
POST   /api/workflows/execution-logs/batch-delete  # 删除执行日志
DELETE /api/workflows/batch                    # 批量删除
```

### 3.3 工作流快照
```
POST   /api/workflows/:id/snapshots           # 保存快照
GET    /api/workflows/:id/snapshots           # 获取快照列表
POST   /api/workflows/:id/snapshots/:sid/restore  # 恢复快照
DELETE /api/workflows/:id/snapshots/:sid      # 删除快照
```

### 3.4 工作流检查点
```
POST   /api/workflows/:id/resume-from-checkpoint  # 从检查点恢复
GET    /api/workflows/:id/checkpoints             # 获取检查点列表
```

### 3.5 工作流审批
```
POST   /api/workflows/approval/respond        # 审批响应
GET    /api/workflows/:id/input-required      # 获取需要输入的内容
```

### 3.6 工作流上下文
```
GET    /api/workflows/:id/context             # 获取上下文
PUT    /api/workflows/:id/context             # 更新上下文
GET    /api/workflows/:id/variables           # 获取变量
```

### 3.7 任务管理
```
GET    /api/tasks                             # 列表
GET    /api/tasks/:id                         # 详情
POST   /api/tasks                             # 创建
PUT    /api/tasks/:id                         # 更新
DELETE /api/tasks/:id                         # 删除
POST   /api/tasks/:id/execute                 # 执行
POST   /api/tasks/:id/cancel                  # 取消
POST   /api/tasks/:id/pause                   # 暂停
POST   /api/tasks/:id/resume                  # 恢复
DELETE /api/tasks/batch                       # 批量删除
```

### 3.8 任务队列
```
GET    /api/task-queues                       # 列表
GET    /api/task-queues/:id                   # 详情
POST   /api/task-queues                       # 创建
PUT    /api/task-queues/:id                   # 更新
DELETE /api/task-queues/:id                   # 删除
POST   /api/task-queues/:id/start             # 启动
POST   /api/task-queues/:id/pause             # 暂停
POST   /api/task-queues/:id/resume            # 恢复
POST   /api/task-queues/:id/cancel            # 取消
POST   /api/task-queues/:id/items             # 添加项
DELETE /api/task-queues/:id/items/:itemId     # 删除项
DELETE /api/task-queues/batch                 # 批量删除
```

### 3.9 文件管理
```
GET    /api/files                             # 列表
GET    /api/files/read                        # 读取
POST   /api/files/write                       # 写入
POST   /api/files/mkdir                       # 创建目录
DELETE /api/files                             # 删除
POST   /api/files/rename                      # 重命名
GET    /api/files/browse                      # 浏览目录
POST   /api/files/set-workspace               # 设置工作区
GET    /api/files/workspace-info              # 工作区信息
POST   /api/files/workspace                   # 创建工作区
POST   /api/files/import                      # 导入文件
GET    /api/files/parent                      # 获取父目录
GET    /api/files/undo-cache                  # 获取撤销缓存
POST   /api/files/undo-cache                  # 保存撤销缓存
DELETE /api/files/undo-cache                  # 清除撤销缓存
```

### 3.10 工作区管理
```
GET    /api/workspaces                        # 列表
POST   /api/workspaces                        # 激活
DELETE /api/workspaces/:id                    # 停用
GET    /api/workspaces/:id/state              # 状态
GET    /api/workspaces/:id/workflows          # 工作流
```

### 3.11 对话管理
```
GET    /api/chat                              # 会话列表
GET    /api/chat/:id                          # 会话详情
POST   /api/chat                              # 创建会话
DELETE /api/chat/:id                          # 删除会话
POST   /api/chat/:id/messages                 # 发送消息
POST   /api/chat/:id/archive                  # 归档
POST   /api/chat/:id/execute                  # 执行操作
GET    /api/chat/search                       # 搜索
POST   /api/chat/slash-commands               # 斜杠命令
```

### 3.12 终端管理
```
POST   /api/terminal                          # 创建
GET    /api/terminal                          # 列表
DELETE /api/terminal/:id                      # 关闭
POST   /api/terminal/:id/input                # 输入
GET    /api/terminal/:id/output               # 输出
POST   /api/terminal/:id/resize               # 调整大小
GET    /api/terminal/:id/history              # 历史
POST   /api/terminal/restore                  # 恢复
```

### 3.13 API密钥管理
```
GET    /api/api-keys                          # 列表
POST   /api/api-keys                          # 创建
PUT    /api/api-keys/:id                      # 更新
DELETE /api/api-keys/:id                      # 删除
PUT    /api/api-keys/:id/default              # 设为默认
GET    /api/api-keys/:id/test                 # 测试连接
GET    /api/api-keys/:id/key                  # 获取密钥
```

### 3.14 知识库
```
GET    /api/knowledge                         # 搜索
POST   /api/knowledge                         # 添加
PUT    /api/knowledge/:id                     # 更新
DELETE /api/knowledge/:id                     # 删除
GET    /api/knowledge/tags                    # 标签列表
POST   /api/knowledge/tags                    # 添加标签
DELETE /api/knowledge/tags/:id                # 删除标签
GET    /api/knowledge/export                  # 导出
POST   /api/knowledge/import                  # 导入
```

### 3.15 记忆管理
```
GET    /api/memory/search                     # 搜索
GET    /api/memory/:workflowId                # 获取
PUT    /api/memory/:workflowId                # 更新
DELETE /api/memory/:workflowId                # 删除
GET    /api/memory/shared/pool                # 共享池
PUT    /api/memory/shared/pool                # 更新共享池
GET    /api/memory/list                       # 列表
```

### 3.16 广播
```
POST   /api/broadcast                         # 发送广播
GET    /api/broadcast/history                 # 历史
GET    /api/clients                           # 客户端列表
```

### 3.17 Git操作
```
GET    /api/git/status                        # 状态
GET    /api/git/diff                          # 差异
GET    /api/git/log                           # 日志
POST   /api/git/commit                        # 提交
POST   /api/git/checkout                      # 切换分支
GET    /api/git/branches                      # 分支列表
POST   /api/git/branch                        # 创建分支
POST   /api/git/stage                         # 暂存
POST   /api/git/unstage                       # 取消暂存
GET    /api/git/check                         # 检查仓库
```

### 3.18 技能管理
```
GET    /api/skills                            # 列表
POST   /api/skills/:id/install                # 安装
DELETE /api/skills/:id/uninstall              # 卸载
GET    /api/skills/installed                  # 已安装
GET    /api/skills/agent/:id                  # Agent技能
```

### 3.19 审计日志
```
GET    /api/audit-logs                        # 日志列表
GET    /api/audit                             # 日志列表 (别名)
```

### 3.20 资源监控
```
GET    /api/resources                         # 系统资源
GET    /api/resources/agents                  # Agent进程
```

### 3.21 历史记录
```
GET    /api/history                           # 列表
GET    /api/history/:runId                    # 详情
DELETE /api/history/:runId                    # 删除
DELETE /api/history/batch                     # 批量删除
```

### 3.22 报告
```
GET    /api/reports                           # 列表
GET    /api/reports/:wfId/:runId              # 详情
DELETE /api/reports/:wfId/:runId              # 删除
POST   /api/reports/generate                  # 生成
GET    /api/reports/:wfId/:runId/download     # 下载
```

### 3.23 工件
```
GET    /api/artifacts                         # 列表
GET    /api/artifacts/:id                     # 详情
GET    /api/artifacts/:id/content             # 内容
DELETE /api/artifacts/:id                     # 删除
POST   /api/artifacts/reindex                 # 重建索引
```

### 3.24 工作流模板
```
GET    /api/workflow-templates                # 列表
POST   /api/workflow-templates/:id/clone      # 克隆
```

### 3.25 提示词模板
```
GET    /api/prompt-templates                  # 列表
GET    /api/prompt-templates/:id              # 详情
POST   /api/prompt-templates                  # 创建
PUT    /api/prompt-templates/:id              # 更新
DELETE /api/prompt-templates/:id              # 删除
POST   /api/prompt-templates/:id/use          # 使用
```

---

## 4. WebSocket 事件

### 4.1 客户端订阅

```javascript
// ws.js 中自动订阅
WS.send('subscribe', { 
  channels: ['agents', 'tasks', 'workflows', 'logs', 'claude', 'queues', 'terminal', 'chat'] 
});
```

### 4.2 后端广播服务

```typescript
// 后端广播方法 (BroadcastService)
broadcastService.broadcast(channel, payload)
```

### 4.3 事件列表

| 事件 | 方向 | 说明 | 数据 | 前端处理 |
|------|------|------|------|----------|
| `chat.stream` | 后端→前端 | 对话流式消息 | sessionId, chunk, done | ChatPage: 流式显示 |
| `claude.stream` | 后端→前端 | Claude流式输出 | taskId, chunk | - |
| `workflow.statusUpdate` | 后端→前端 | 工作流状态变更 | workflowId, status | WorkflowsPage: 更新状态 |
| `workflow.nodeUpdate` | 后端→前端 | 节点状态变更 | workflowId, nodeId, status | WorkflowCanvas: 更新节点 |
| `workflow.humanIntervention` | 后端→前端 | 需要人工干预 | workflowId, nodeId | WorkflowsPage: 显示提示 |
| `workflow.approvalRequested` | 后端→前端 | 审批请求 | workflowId, nodeId, content | WorkflowCanvas: 审批对话框 |
| `task.completed` | 后端→前端 | 任务完成 | taskId, taskName | Toast通知 |
| `task.failed` | 后端→前端 | 任务失败 | taskId, error | Toast通知 |
| `task.progress` | 后端→前端 | 任务进度 | taskId, progress | TasksPage: 更新进度 |
| `queue.completed` | 后端→前端 | 队列完成 | queueName | Toast通知 |
| `queue.failed` | 后端→前端 | 队列失败 | queueName | Toast通知 |
| `queue.waitingHuman` | 后端→前端 | 队列等待人工 | queueName | Toast通知 |
| `agent.statusUpdate` | 后端→前端 | Agent状态变更 | agentId, status | AgentsPage: 更新状态 |
| `agent.tool_use` | 后端→前端 | 工具调用 | taskId, toolName, toolInput | Console日志 |
| `agent.tool_result` | 后端→前端 | 工具结果 | taskId, toolUseId, toolResult | Console日志 |
| `agent.tool_blocked` | 后端→前端 | 工具被拦截 | taskId, toolName, reason | Toast警告 |
| `client.count` | 后端→前端 | 客户端数量 | count | Navbar: 更新计数 |
| `files.generated` | 后端→前端 | 文件生成 | taskId, files | Toast通知 |

### 4.4 WebSocket 连接管理

```javascript
// ws.js 自动重连机制
- 最大重连次数: 10
- 重连延迟: 指数退避 (1s → 30s)
- 心跳间隔: 25秒
- 断开时: 发送 'ws:reconnected' 事件
```

---

## 5. 数据存储

### 5.1 全局数据 (`data/`)

| 文件 | 说明 | 服务 |
|------|------|------|
| `agents.json` | Agent配置 | AgentService |
| `workflows.json` | 工作流定义 | WorkflowService |
| `tasks.json` | 任务配置 | TaskService |
| `task-queues.json` | 任务队列 | TaskQueueService |
| `chat-sessions.json` | 对话会话 | ChatService |
| `prompt-templates.json` | 提示词模板 | PromptTemplateService |
| `api-keys.enc.json` | API密钥（加密） | ApiKeyService |
| `audit-logs.json` | 审计日志 | AuditService |
| `active-workspaces.json` | 活跃工作区 | WorkspaceManager |
| `.task_cache.json` | 任务去重缓存 | SdkService |

### 5.2 工作区数据 (`workspace/<wsId>/`)

| 目录/文件 | 说明 | 服务 |
|-----------|------|------|
| `.context/` | 记忆存储 | MemoryService |
| `.context/shared/pool.json` | 共享数据池 | MemoryService |
| `WORKFLOWS/checkpoints/` | 检查点 | CheckpointService |
| `WORKFLOWS/snapshots/` | 快照 | SnapshotService |

---

## 6. 认证机制

### 6.1 API Key 认证

```javascript
// 前端请求头
headers: {
  'X-API-Key': apiKey
}
```

### 6.2 WebSocket 认证

```javascript
// WebSocket 连接URL
ws://localhost:3456/ws?api_key=xxx
```

### 6.3 API Key 管理

- 存储位置：`data/api-key.json`（明文）或 `data/api-keys.enc.json`（加密）
- 配置位置：前端设置页面
- 验证中间件：`middleware/auth.ts`

---

## 7. 关键架构特点

### 7.1 状态管理

```javascript
// store.js - 内存状态
Store.set('activeWorkspaceId', wsId);
Store.get('activeWorkspaces');
```

### 7.2 路由

```javascript
// Hash-based SPA routing
Router.navigate('/workflows');
window.location.hash = '#/workflows';
```

### 7.3 组件通信

- **父子组件**：Props + Callbacks
- **跨组件**：WebSocket 事件 + Store
- **全局状态**：Store (内存) + localStorage

---

*文档基于当前代码库生成*
