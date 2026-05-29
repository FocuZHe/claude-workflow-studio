[English](README_EN.md) | 中文

> ⚠️ **开发状态：实验性预览版** — 本项目由知识面较浅薄的大一学生自行开发，功能可能有很多不完善之处，存在未发现的 Bug。**未经充分生产环境测试，请不要用于重要文件的修改上。** 欢迎 Fork 自行修改。维护时间有限，Issue 和 PR 处理可能不及时。

# Claude Workflow Studio

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

## 快速开始

**环境要求**：[Node.js 18+](https://nodejs.org/) 和 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

**安装**：解压 ZIP → 双击 `install.bat` → 双击 `start.bat` → 访问 http://localhost:3000

```bash
npm install    # 或双击 install.bat
npm start      # 或双击 start.bat
```

---

## 快速上手

**单 Agent 任务**：智能体 → 创建智能体 → 任务 → 创建任务 → 选择 Agent → 输入需求 → 执行

**多 Agent 流水线**：工作流 → 创建工作流 → 拖入 Agent 节点 → 连线 → 保存 → 执行

**文件管理**：文件 → 浏览/新建/编辑工作区内的文件

---

## 核心功能

| 功能 | 说明 |
|------|------|
| **双引擎执行** | SDK 主 Agent 编排 + CLI 子 Agent 执行，真实进程隔离 |
| **可视化工作流** | 7 种节点类型，拖拽编排，AI 自然语言生成工作流 |
| **技能市场** | 249 个真实技能，来自 Anthropic 官方和 ECC 社区 |
| **实时流式输出** | 所有子 Agent 输出通过 WebSocket 实时推送 |
| **断点续传** | 节点级检查点，崩溃或暂停后从断点恢复 |
| **记忆系统** | 任务标签记忆、关键词过滤注入、`[记忆: xxx]` 主动提取 |
| **工作流互操作** | 导入/导出 Claude Code `.md` 格式工作流 |
| **多工作区** | 独立运行环境，数据隔离 |
| **任务队列** | 批量执行，支持暂停/恢复/取消 |
| **知识库** | 分类/标签管理，全文搜索，可注入 Agent 执行 |

### 工作流节点

| 节点 | 说明 |
|------|------|
| **开始** | 工作流入口 |
| **Agent** | 调用 AI 执行任务 |
| **并行** | 并发派发多个子 Agent |
| **审批** | 暂停等待用户审批 |
| **合并** | 收集上游输出 |
| **子工作流** | 展开嵌入另一个工作流 |
| **结束** | 汇总最终结果 |

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | HTML + CSS + 原生 JS（SPA）+ xterm.js |
| 后端 | Node.js + Express |
| 实时通信 | WebSocket (ws) |
| AI - 主 Agent | Anthropic SDK (tool_use 循环) |
| AI - 子 Agent | Claude Code CLI (child_process.spawn) |
| 数据持久化 | sql.js (WASM SQLite) |

---

## 常见问题

**Q: Agent 执行失败？** → 检查 CLI 是否安装（`claude --version`），CLI 不可用时自动回退 SDK 模式

**Q: 工作流中断了？** → 重启服务，点击「续传」从断点恢复

**Q: 数据会丢吗？** → 每 2 秒自动保存，正常关闭不会丢数据

**Q: 能管理多个项目吗？** → 可以，通过「文件」→「切换工作区」创建独立环境

---

## 常用命令

```bash
npm start              # 启动服务器
npm run dev            # 开发模式（自动重启）
npm test               # 运行测试
```

---

> 深度技术文档（执行引擎、记忆系统、安全机制、API 概览等）请参考 [docs/architecture.md](docs/architecture.md)。
