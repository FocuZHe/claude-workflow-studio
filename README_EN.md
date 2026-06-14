<p align="center">
  <img src="screenshots/标题.png" alt="Claude Workflow Studio" width="80%">
</p>

<p align="center">
  <a href="README_EN.md">English</a> · <a href="README.md">中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/release-v1.5-blue?style=flat-square" alt="Release">
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/node-%3E%3D18-green?style=flat-square" alt="Node.js">
  <img src="https://img.shields.io/badge/claude--code-CLI-orange?style=flat-square" alt="Claude Code CLI">
</p>

<p align="center">A web-based visual platform for orchestrating, monitoring, and managing multiple Claude Code Agents to collaborate on complex tasks.</p>

> ⚠️ **Status: Experimental Preview** — This project is developed by a first-year college student with limited knowledge. Features may have many imperfections and undiscovered bugs may exist. **Not thoroughly tested in production environments — do not use for modifying important files.** Feel free to fork and modify. Maintenance time is limited; issues and PRs may not be addressed promptly.

<p align="center">
  <img src="screenshots/控制台.png" alt="Dashboard — View agent status, workflow progress, and system statistics" width="45%">
  <img src="screenshots/工作流.png" alt="Workflow Editor — Drag-and-drop node editor with multiple node types" width="45%">
</p>
<p align="center">
  <img src="screenshots/市场.png" alt="Skills Marketplace — Browse and install Skills, manage MCP servers" width="45%">
  <img src="screenshots/文件.png" alt="File Manager — Browse and edit workspace files with embedded terminal" width="45%">
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

**Multi-Agent pipeline**:
1. Workflows → Create Workflow → Drag Agent nodes → Connect edges → Save
2. Tasks → Create Task → Select associated workflow → Enter task description → Execute

**File management**: Files → Browse/create/edit workspace files

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Double-Loop Architecture** | Master Agent (Native API) coordinates + Sub Agent (SDK) executes, physical isolation prevents hallucination |
| **Visual Workflows** | 7 node types, drag-and-drop editor, AI workflow generation |
| **Workflow Templates** | 13 built-in templates: code review, bug fix, doc generation, security audit, etc. |
| **MCP Server Support** | Directly use MCP servers configured in Claude CLI, no additional setup needed |
| **Claude Skills Compatible** | Directly use Skills installed in Claude CLI, auto-loaded to sub-agents |
| **Human Approval Gate** | Orchestrator-level interception, pause for human review, support approve/reject, reject automatically passes feedback to main Agent for retry |
| **Real-time Streaming** | All sub-agent output streamed via WebSocket (50ms buffer) |
| **Checkpoint/Resume** | Per-node checkpoints, resume from breakpoint after crash or pause |
| **Memory System** | Per-workspace isolation, toggle control, cross-workflow sharing, shared data pool |
| **Embedded Terminal** | Real PTY terminal via node-pty, supports all shell commands, auto-opens in current workspace |
| **Multi-Workspace** | Isolated runtime environments, batch clone workflows to other workspaces |
| **Task Queues** | Batch execution with pause/resume/cancel, priority + time sorting |
| **Knowledge Base** | Category/tag organization, full-text search, injectable into agents |
| **Analytics** | Execution statistics, success rate, average duration, per-workflow stats, execution timeline |
| **AI Chat** | Read-only mode, supports WebSearch, WebFetch, file read/search |
| **Security** | API Key AES-256-GCM encryption, command whitelist, workspace sandbox, rate limiting, security headers |

### Workflow Nodes

| Node | Description |
|------|-------------|
| **Start** | Workflow entry |
| **Agent** | Execute task via AI (supports multiple roles: developer, reviewer, tester, etc.) |
| **Approval** | Pause for human review, support approve/reject, reject triggers retry |
| **Condition** | Branch based on upstream output, choose one path to execute |
| **Sub-workflow** | Reference another workflow, inline execution |
| **End** | Produce final result |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML + CSS + TypeScript/JS (SPA) + xterm.js |
| Backend | Node.js + Express + TypeScript |
| Real-time | WebSocket (ws) |
| AI Engine | Double-loop: Master Agent (Native Anthropic API) + Sub Agent (Claude Agent SDK) |
| Database | sql.js (WASM SQLite) + JSON files |

---

## MCP & Skills

Our platform's sub-agents directly inherit Claude CLI's configuration — no extra setup required.

- **MCP Servers**: Configure in Claude CLI, sub-agents use them automatically
- **Skills**: Install in Claude CLI, sub-agents load them automatically

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

### Batch Scripts (Windows)

| Script | Description |
|--------|-------------|
| `install.bat` | One-click dependency install |
| `start.bat` | Start service |
| `stop.bat` | Stop service |
| `restart.bat` | Restart service |
| `logs.bat` | View logs |
| `add-to-startup.bat` | Add to startup |
| `remove-from-startup.bat` | Remove from startup |

---

> Detailed technical documentation (execution engine, memory system, security, API overview) → [docs/architecture_EN.md](docs/architecture_EN.md)

---

## License

[MIT License](LICENSE)
