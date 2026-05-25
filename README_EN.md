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

## Architecture Overview

```
Browser (SPA)
  HTML + CSS + Vanilla JS + xterm.js
      │  HTTP REST + WebSocket
      ▼
Express + WebSocket Server
  Auth │ Rate Limit │ Routes │ Middleware
      │
      ▼
Dual-Engine Execution

  ┌─ Master Agent (SDK) ──→ Sub Agent (CLI)
  │  tool_use loop          claude --print
  │  Agent tools            Full toolset
  │  Orchestrate            Process isolation
  │
  └─ Fallback: CLI unavailable → SDK mode

      │
      ▼
Data Layer
  sql.js (WASM SQLite) │ JSON │ Workspace Files
```

### Dual-Engine Execution Model

| | Master Agent | Sub Agent |
|---|---|---|
| **Engine** | Anthropic SDK | `claude --print` CLI |
| **Mechanism** | `tool_use` loop | Child process (spawn) |
| **Tools** | Custom `Agent_nX` tools + Bash | Full toolset |
| **Context** | Orchestration only | Isolated per-node window |
| **Isolation** | Shared orchestrator process | Real process isolation (separate PID) |
| **Configuration** | API Key from Settings | Model + skills forced by node config |

The master agent uses the Anthropic SDK to run a `tool_use` loop. Each workflow node becomes a named tool (`Agent_n2`, `Agent_n3`, etc.). When the model calls one, the backend spawns an independent `claude --print` CLI process with that node's specific model, skills, and system prompt. If the CLI is unavailable, sub-agents automatically fall back to SDK mode.

---

## Quick Start

**First time:** Double-click **`install.bat`** -- auto-install dependencies -- double-click **`start.bat`** -- visit **http://localhost:3000**

Double-click **`stop.bat`** to stop.

**Prerequisites:** [Node.js 18+](https://nodejs.org/) and [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

### Manual Setup

```bash
npm install
npm start        # Server starts on port 3000
npm run dev      # Dev mode with auto-restart
npm test         # Run backend tests
```

---

## Key Features

### Execution

- **Dual-engine architecture**: SDK master agent orchestrates CLI sub-agents with full process isolation
- **Named Agent tools**: Each workflow node maps to a named tool (`Agent_n2`, `Agent_n3`, ...) in the SDK tool_use loop
- **Checkpoint/Resume**: Per-step checkpoint files saved to `.checkpoint/` after each agent completes. Resume skips completed steps.
- **Pause/Resume**: Immediate pause via abortSignal (< 5s). Resume uses checkpoints.
- **Approval nodes**: Real WebSocket round-trip -- execution pauses until user approves or rejects
- **Parallel nodes**: Atomic concurrent agent spawning in a single SDK message

### Features

- **Workflow templates (19)**: Pre-built templates with preset skills for common scenarios
- **AI workflow generation**: Describe in natural language, AI generates the complete workflow DAG
- **Skills marketplace**: 249 real skills from anthropics/skills and affaan-m/ECC, organized in 19 categories
- **Multi-config API Key management**: AES-256-GCM encrypted, manage multiple keys in Settings
- **WebSocket real-time streaming**: Live output from all sub-agents, broadcast to all connected clients
- **sql.js persistence**: Pure WASM SQLite, zero native dependencies, auto-migration from JSON
- **Multi-workspace support**: Isolated environments with independent data, workflows, and configurations
- **Task queues**: Batch execution with pause/resume/cancel, sequential processing
- **Knowledge base**: Organized by categories and tags, full-text search, injectable into agent execution
- **Memory system**: Per-workflow memory accumulation, cross-workflow transfer, shared data pool, auto-compression
- **Audit logs**: Full operation auditing, real-time persistence, last 1000 entries retained
- **Security**: Workspace sandbox, path traversal prevention, three-tier rate limiting, memory sandbox (2GB RSS limit)

### Workflow Node Types

| Node | Description |
|------|-------------|
| **Start** | Workflow entry, passes input to downstream nodes |
| **Agent** | Executes tasks via Anthropic SDK with node-specific model/skills/prompt |
| **Parallel** | Atomic concurrent spawning of multiple agents in a single message |
| **Approval** | WebSocket round-trip -- pauses until user approves or rejects |
| **Merge** | Collects direct upstream outputs, joins with `---` separator |
| **Sub-workflow** | Select another workflow, its nodes and edges are inlined/expanded in the editor |
| **End** | Gathers upstream output, produces final result |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML + CSS + Vanilla JS (SPA) + xterm.js |
| Backend | Node.js + Express |
| Real-time | WebSocket (ws) |
| AI - Master | Anthropic SDK (tool_use loop) |
| AI - Sub | Claude Code CLI (child_process.spawn) |
| Database | sql.js (WASM SQLite, zero native deps) |
| Icons | SVG sprite (`icons.svg`, 40+ icons) |
| Design System | CSS variables + DM Sans / JetBrains Mono |
| Testing | Jest |

---

## Agent Configuration

| Setting | Description |
|---------|-------------|
| **Model** | opus (strongest reasoning) / sonnet (balanced) / haiku (fast) -- CLI aliases via ccswitch |
| **System Prompt** | Defines agent behavior and persona |
| **Temperature** | Output randomness (0-1) |
| **Tool Permissions** | Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch |
| **Role Presets** | Developer, Reviewer, Tester, Planner, Debugger, Documenter, Custom |

---

## Workspace Management

Each workspace is an isolated runtime environment:

```
workspace/<wsId>/
├── WORKFLOWS/                # Workflows, skills, knowledge, etc.
│   ├── workflows.json
│   ├── knowledge.json
│   ├── tags.json
│   ├── artifact-index.json
│   ├── chat-sessions.json
│   ├── prompt-templates.json
│   ├── skills.json
│   ├── mcp-tools.json
│   ├── execution-log.json
│   ├── .checkpoint/          # Per-step checkpoint files
│   └── snapshots/            # Workflow state snapshots
├── reports/                  # Execution reports
├── .context/                 # Workflow memory
│   ├── <workflow-id>.md
│   └── shared/
│       └── pool.json
└── .BACKUP/                  # Auto-backup (crash recovery)
```

- Auto-loads data when switching workspaces
- Global data (tasks, queues, agents) in `data/` directory, unaffected by workspace switching
- Backup/migration: copy `data/` + `workspace/` directories

---

## Directory Structure

```
my-project/
├── src/
│   ├── server/               # Backend code
│   │   ├── app.js            # Express application
│   │   ├── routes/           # API routes
│   │   ├── services/         # Business logic
│   │   ├── models/           # Data models
│   │   └── middleware/       # Middleware
│   └── client/               # Frontend code
│       ├── index.html        # SPA entry
│       ├── icons.svg         # SVG icon sprite (40+ icons)
│       ├── js/
│       │   ├── pages/        # Page components
│       │   └── components/   # Shared components
│       └── css/              # Styles (5 files)
├── workspace/                # Default workspace
├── data/                     # Global data
│   ├── app.db                # SQLite (sql.js WASM)
│   ├── agents.json           # Agent configurations
│   ├── tasks.json            # Global tasks
│   ├── task-queues.json      # Task queues
│   ├── api-key.json          # AES-256-GCM encrypted API Key
│   ├── audit-logs.json       # Audit logs
│   ├── skills/               # Installed skill states
│   ├── mcp/                  # MCP tool configs
│   └── chat-workspace/       # Isolated chat workspace
├── tests/                    # Test files
│   ├── server/               # Backend tests
│   └── frontend/             # Frontend tests
├── docs/
│   └── architecture.md       # Detailed architecture docs
├── install.bat               # One-click install
├── start.bat                 # Start service
├── stop.bat                  # Stop service
├── README.md                 # Chinese docs
└── README_EN.md              # English docs (this file)
```

---

## API Overview

Unified response format:
```json
{ "success": true, "data": { ... }, "meta": { "total": 100, "page": 1, "limit": 20 } }
```

| Module | Endpoint | Description |
|--------|----------|-------------|
| Agents | `/api/agents` | CRUD + batch delete |
| Workflows | `/api/workflows` | CRUD + execute + snapshot + AI create + import/export + batch clone |
| Tasks | `/api/tasks` | CRUD + batch delete |
| Task Queues | `/api/task-queues` | Queue management, batch execution |
| Files | `/api/files` | Browse + read/write + workspace switching |
| Knowledge | `/api/knowledge` | CRUD + search + tags + import/export |
| Memory | `/api/memory` | Read/write + search + shared pool |
| Artifacts | `/api/artifacts` | Index + search + preview + delete |
| Reports | `/api/reports` | Execution reports |
| Chat | `/api/chat` | Session management |
| Terminal | `/api/terminal` | PTY sessions |
| Skills | `/api/skills` | Install + uninstall + marketplace |
| History | `/api/history` | Execution history |
| MCP | `/api/mcp-tools` | MCP tool management |
| Broadcast | `/api/broadcast` | Event broadcasting |
| Auth | `/api/auth/key` | API Key retrieval |
| Health | `/api/health` | Service status + CLI compatibility |

---

## Security

- **API Key auth**: Auto-generated on first startup, AES-256-GCM encrypted. HTTP via `X-API-Key` header, WebSocket via `?api_key=` query parameter
- **Three-tier rate limiting**: Global 600/min, writes 200/10s, auth 10/min
- **Workspace sandbox**: `--permission-mode acceptEdits` enforces workspace-scoped writes
- **Path traversal prevention**: All file paths validated through resolvePath
- **Agent memory sandbox**: Monitors RSS every 10s, auto-kills at 2GB
- **Tool whitelist**: Edit/Write (workspace only), Read, Bash (read-only commands), WebSearch/Fetch, Agent, Glob/Grep
- **Log persistence**: Daily rotation `logs/app-YYYY-MM-DD.log`, auto-clean after 30 days

---

## Data Protection

### Three-Layer Protection

| Layer | Mechanism |
|-------|-----------|
| **During Execution** | 9 error categories + adaptive backoff + model fallback + input truncation + circuit breaker |
| **On Shutdown** | 6 model synchronous flush + workspace state flush + file watcher cleanup |
| **On Restart** | Checkpoint detection + interrupted flag + memory injection + resume execution |

### Model Fallback Chain

```
opus → sonnet → haiku (using CLI aliases)
Unknown model → haiku (fallback)
```

### Circuit Breaker

5 consecutive failures across tasks/nodes -- trip for 30s -- half-open probe -- recover or re-trip.

---

## Performance Optimizations

| Optimization | Description |
|-------------|-------------|
| Paginated lazy loading | 20 items/page, "Load More" for next page |
| WebSocket auto-reconnect | Exponential backoff (max 30s), up to 10 attempts |
| Message throttling | WebSocket messages throttled to 2s for dashboard, 500ms for task/agent lists |
| Client-side caching | `Cache` utility class with TTL (default 5 minutes) |
| CPU sampling | Two samples at 500ms interval for accurate usage |
| Async persistence | Write queue serialization, non-blocking event loop |
| Adaptive font scaling | Viewport diagonal scaling, 60ms debounce, 70%-100% range |
| Sidebar auto-collapse | Icon mode below 880px, overlay mode below 30% screen width |

---

## FAQ

**Q: Agent execution failed?**
- Check if Claude Code CLI is installed: `claude --version`
- Check if API key is configured
- Sub-agents fall back to SDK mode if CLI is unavailable

**Q: Workflow interrupted mid-execution?**
- Restart the service. Checkpoints auto-detect and mark the workflow as interrupted.
- Go to "Workflows", find the interrupted workflow, click "Resume".

**Q: Will data be lost?**
- Data auto-saves every 2 seconds. Normal shutdown loses nothing.
- Even with sudden power loss, at most 2 seconds of data is lost.

**Q: Can I manage multiple projects?**
- Yes. Click "Files" -- "Switch Workspace" to create/switch between isolated workspaces.

**Q: Can agents access files outside the workspace?**
- No. All agents are sandboxed within the workspace directory.

---

*Detailed architecture documentation: [docs/architecture.md](docs/architecture.md) (Chinese)*
