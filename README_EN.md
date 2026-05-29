English | [中文](README.md)

> ⚠️ **Status: Experimental Preview** — This project is developed by a first-year college student with limited knowledge. Features may have many imperfections and undiscovered bugs may exist. **Not thoroughly tested in production environments — do not use for modifying important files.** Feel free to fork and modify. Maintenance time is limited; issues and PRs may not be addressed promptly.

# Claude Agent Studio

A web-based visual platform for orchestrating, monitoring, and managing multiple Claude Code Agents to collaborate on complex tasks. Features drag-and-drop workflow editor, real-time streaming output, checkpoint/resume, memory transfer, and a skills marketplace.

<p align="center">
  <img src="screenshots/控制台.png" alt="Dashboard" width="45%">
  <img src="screenshots/工作流.png" alt="Workflow Editor" width="45%">
</p>
<p align="center">
  <img src="screenshots/市场.png" alt="Skills Marketplace" width="45%">
  <img src="screenshots/文件.png" alt="File Manager" width="45%">
</p>

---

## Quick Start

**Requirements**: [Node.js 18+](https://nodejs.org/) and [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

**Install**: Unzip → Double-click `install.bat` → Double-click `start.bat` → Visit http://localhost:3000

```bash
npm install    # or double-click install.bat
npm start      # or double-click start.bat
```

---

## Quick Tutorial

**Single Agent task**: Agents → Create Agent → Tasks → Create Task → Select Agent → Enter prompt → Execute

**Multi-Agent pipeline**: Workflows → Create Workflow → Drag Agent nodes → Connect edges → Save → Execute

**File management**: Files → Browse/create/edit workspace files

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Dual-Engine Execution** | SDK master agent + CLI sub-agents, real process isolation |
| **Visual Workflows** | 7 node types, drag-and-drop editor, AI workflow generation |
| **Skills Marketplace** | 249 real skills from Anthropic and ECC community |
| **Real-time Streaming** | All sub-agent output streamed via WebSocket |
| **Checkpoint/Resume** | Per-node checkpoints, resume from breakpoint after crash or pause |
| **Memory System** | Task-tagged memory, keyword-filtered injection, `[记忆: xxx]` marker extraction |
| **Workflow Interop** | Import/export Claude Code `.md` workflow files |
| **Multi-Workspace** | Isolated runtime environments with independent data |
| **Task Queues** | Batch execution with pause/resume/cancel |
| **Knowledge Base** | Category/tag organization, full-text search, injectable into agents |

### Workflow Nodes

| Node | Description |
|------|-------------|
| **Start** | Workflow entry |
| **Agent** | Execute task via AI |
| **Parallel** | Concurrent agent spawning |
| **Approval** | Pause for user approval |
| **Merge** | Collect upstream outputs |
| **Sub-workflow** | Inline another workflow |
| **End** | Produce final result |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML + CSS + Vanilla JS (SPA) + xterm.js |
| Backend | Node.js + Express |
| Real-time | WebSocket (ws) |
| AI - Master | Anthropic SDK (tool_use loop) |
| AI - Sub | Claude Code CLI (child_process.spawn) |
| Database | sql.js (WASM SQLite) |

---

## FAQ

**Q: Agent execution failed?** → Check CLI installed (`claude --version`). Falls back to SDK mode if CLI unavailable.

**Q: Workflow interrupted?** → Restart service, click "Resume" to continue from checkpoint.

**Q: Will data be lost?** → Auto-saves every 2 seconds. Normal shutdown loses nothing.

**Q: Multiple projects?** → Yes, use Files → Switch Workspace to create isolated environments.

---

## Commands

```bash
npm start              # Start server
npm run dev            # Dev mode (auto-restart)
npm test               # Run tests
```

---

> Detailed technical documentation (execution engine, memory system, security, API overview) → [docs/architecture.md](docs/architecture.md)
