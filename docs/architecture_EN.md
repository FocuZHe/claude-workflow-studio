# Claude Workflow Studio — Architecture Documentation

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Claude Agent SDK Integration](#2-claude-agent-sdk-integration)
3. [TS Hard State Machine Driven Execution](#3-ts-hard-state-machine-driven-execution)
4. [Named Agent Tool Mechanism](#4-named-agent-tool-mechanism)
5. [Workflow Execution Engine](#5-workflow-execution-engine)
6. [Checkpoints and Resume](#6-checkpoints-and-resume)
7. [Approval and Parallel Nodes](#7-approval-and-parallel-nodes)
8. [Frontend-Backend Communication](#8-frontend-backend-communication)
9. [Database Design (Conceptual)](#9-database-design-conceptual)
10. [Workspace Sandbox and Security](#10-workspace-sandbox-and-security)
11. [Skill Injection Flow](#11-skill-injection-flow)
12. [Memory System](#12-memory-system)
13. [Self-Healing and Fault Tolerance](#13-self-healing-and-fault-tolerance)
14. [Data Persistence Mechanism](#14-data-persistence-mechanism)
15. [Technical Parameters Summary](#15-technical-parameters-summary)
16. [Feature Modules](#16-feature-modules)
17. [Agent Configuration](#17-agent-configuration)
18. [Workspace Management](#18-workspace-management)
19. [Data Storage](#19-data-storage)
20. [Security and Authentication](#20-security-and-authentication)
21. [Error Classification and Adaptive Retry](#21-error-classification-and-adaptive-retry)
22. [Performance Optimization](#22-performance-optimization)
23. [API Overview](#23-api-overview)
24. [Batch Scripts](#24-batch-scripts)
25. [Claude Agent SDK Deep Integration](#25-claude-agent-sdk-deep-integration-added-2026-06-01)
26. [Double-Loop Architecture](#26-double-loop-architecture)
27. [Analytics & Statistics System](#27-analytics--statistics-system)
28. [Task Priority System](#28-task-priority-system)
29. [Workspace Workflow Statistics](#29-workspace-workflow-statistics)
30. [System Resource Monitoring](#30-system-resource-monitoring)

---

## 1. System Architecture Overview

### Architecture Diagram

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

### Data Flow Direction

```
User Action → SPA Frontend → HTTP/WS → Express Routes → Service Layer
    → TS State Machine (WorkflowService._executeWorkflowStateMachine)
        → Sub Agent 1 (query() → Claude Agent SDK subprocess)
        → Sub Agent 2 (query() → Claude Agent SDK subprocess)
        → ...
    → Checkpoint Save → Output Return → WebSocket Broadcast → Frontend Rendering
```

---

## 2. Claude Agent SDK Integration

The platform uses **Claude Agent SDK** as the sole execution engine, launching independent subprocesses via the `query()` function.

### 2.1 SDK Core Invocation

| Property | Description |
|----------|-------------|
| Engine | `@anthropic-ai/claude-agent-sdk` |
| Core Function | `query({ prompt, options })` |
| Subprocess | Each call launches an independent `claude` subprocess |
| Toolset | Built-in tools (Read, Write, Edit, Bash, Glob, Grep) |
| API Key | Configured by user in settings page, AES-256-GCM encrypted storage |

### 2.2 Model Alias System

All model references use aliases, mapped to actual models via `ApiKeyService.resolveModel()`:

| Alias | Meaning | Typical Scenario |
|-------|---------|------------------|
| `opus` | Strongest reasoning | Complex architecture design, multi-step reasoning |
| `sonnet` | Balanced model | Daily coding, code review |
| `haiku` | Fast and lightweight | Simple tasks, AI workflow generation |

Alias changes take effect immediately without restarting the service.

### 2.3 Agent Type Mapping

Claude Agent SDK supported agent types:

| SDK Type | Permissions | Use Case |
|----------|-------------|----------|
| `Explore` | Read-only | Search, analysis (cannot create files) |
| `general-purpose` | Full | Development, testing, documentation (can create files) |

System prompt auto-inference logic:
- Search/analysis tasks → `Explore`
- Development/testing/documentation tasks → `general-purpose`
- Default → `general-purpose`

---

## 3. TS Hard State Machine Driven Execution

**Core Principle:** "Brain belongs to AI, hands and feet belong to code" — TypeScript code directly controls workflow execution, the main agent cannot "pretend to run" sub-agents.

### 3.1 Execution Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Execution Architecture                     │
├─────────────────────────────────────────────────────────────┤
│ TS Code (WorkflowService)                                    │
│    ↓                                                         │
│ Topological Sort → Determine execution order                 │
│    ↓                                                         │
│ Directly call query() → Physically launch subprocess         │
│    ↓                                                         │
│ Sub-Agent executes → Returns result                          │
│    ↓                                                         │
│ TS Code processes result → Passes to next node               │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Execution Flow

1. **Parse Workflow DAG** — Read nodes and edges
2. **Topological Sort** — Determine execution order
3. **Sequential Execution** — Directly call `query()` to execute each node
4. **Parallel Execution** — Use `Promise.all` to execute multiple nodes simultaneously
5. **Condition Evaluation** — Use lightweight AI to evaluate conditions
6. **Approval Node** — Suspend via `Promise` waiting for human confirmation

### 3.3 Key Code

```typescript
// WorkflowService._executeWorkflowStateMachine()
for (const nodeId of topoOrder) {
  const node = nodeMap.get(nodeId);

  switch (node.type) {
    case 'agent':
      // Directly call query() to launch sub-agent
      nodeOutput = await sdkService._executeWithClaudeSdk(...);
      break;

    case 'condition':
      // Use lightweight AI to evaluate condition
      evalResult = sdkService._parseJsonSafely(evalRaw);
      break;

    case 'approval':
      // Suspend waiting for human approval
      approvalResult = await new Promise((resolve) => { ... });
      break;
  }

  // Store result, pass to next node
  nodeResults.set(nodeId, nodeOutput);
}
```

---

## 4. Named Agent Tool Mechanism

### 3.1 Tool Generation

During workflow execution, named Agent tools are dynamically injected into the master Agent's system prompt:

```
Tool naming rule: Agent_n2, Agent_n3, Agent_n4, ...
(n + node index, starting from 2)
```

Each `Agent_nX` tool definition includes:
- **name**: `Agent_nX`
- **description**: Work description for that node (generated from node configuration)
- **input_schema**: Accepts upstream output as input
- **agentType**: Sub-agent type (Explore (read-only) / general-purpose (full))

### 3.2 Tool Invocation Flow

```
Master Agent receives tool call decision
  → Identify the called Agent_nX tool
  → Look up corresponding workflow node configuration by tool name
  → Get node's agentType (default: general)
  → Derive permission configuration based on agentType
  → Inherit parent Agent's system prompt + sub-agent type's system prompt
  → SDK query() subprocess
  → Subprocess config = node model + node skills + node system prompt + derived permissions
  → Pass upstream output as user prompt
  → Wait for subprocess completion (streaming output)
  → Return output as tool_result to master Agent
  → Master Agent continues next tool_use iteration
```

### 3.3 Subagent Type System

Simplified to two SDK native types:

| Type | Name | Permissions | Use Case |
|------|------|-------------|----------|
| `explore` | Explore Agent | Read-only | Search code, find files, analyze code structure |
| `build` | Build Agent | Full | Write code, modify files, execute build tasks |
| `general` | General Agent | Full | Complex tasks, multi-step tasks |
| `test` | Test Agent | Read + Execute | Run tests, verify results |
| `doc` | Doc Agent | Read + Write | Generate documentation, update README |

**Permission Inheritance Mechanism**:
- Sub-agents inherit deny rules from parent Agent
- Sub-agent type permissions are merged with parent permissions
- Parent Agent's deny rules have highest priority

**System Prompt Inheritance**:
- Sub-agents inherit parent Agent's system prompt
- Sub-agent type's system prompt is appended to the end
- Custom system prompts are supported

### 3.4 Streaming Output Mode

All Agents (master Agent and sub-agents) use Anthropic SDK's streaming API:

```javascript
const stream = await client.messages.create({
  model,
  system: [{ type: 'text', text: systemPrompt }],
  messages,
  tools,
  max_tokens: 16000,
  stream: true, // Enable streaming mode
});

for await (const event of stream) {
  if (event.type === 'content_block_delta') {
    const delta = event.delta;
    if (delta.type === 'text_delta') {
      // Real-time push text chunks to frontend
      this._broadcastChunk(taskId, agentId, delta.text, false);
    }
  }
}
```

**Advantages of Streaming Mode**:
- No additional token consumption (just different transmission method)
- Real-time visibility of each token generation
- Better user experience
- Easier debugging and monitoring

### 3.5 Advantages

- **Context Isolation**: Each sub-agent has independent context window, won't exceed limits due to accumulation
- **Configuration Independence**: Different nodes can use different models, skills, system prompts
- **Process Isolation**: One sub-agent crash doesn't affect other sub-agents or main process
- **Security Sandbox**: Each subprocess is independently restricted within workspace directory
- **Type Safety**: Subagent types automatically configure permissions and system prompts
- **Real-time Visibility**: Streaming output lets users see each token generation

---

## 5. Workflow Execution Engine

### 4.1 Execution Entry

```
WorkflowService.execute(workflowId, input, options)
```

### 4.2 Execution Phases

**Phase 1: Preparation**

1. Read workflow definition from database (nodes + edges)
2. Validate DAG integrity (must have start node)
3. Check if already running (prevent duplicate execution)
4. Assign workspace path
5. Generate unique runId
6. Initialize node status (all pending)
7. Memory append-only write (no archiving, append-only + auto-compression)

**Phase 2: Topological Sort**

1. Build adjacency list and indegree array
2. BFS layering — nodes in same layer with indegree=0 can run in parallel
3. Generate layered execution plan

**Phase 3: Build Master Agent System Prompt**

```
System Prompt = [
  Base role instructions,
  Workflow DAG description,
  Named Agent tool list (Agent_n2, Agent_n3, ...),
  Subagent type description (Explore (read-only) / general-purpose (full)),
  Execution rules (serial by layer, parallel within layer),
  Checkpoint rules (save after each node completion),
  memory injection (saved workflow memory),
  knowledge injection (manually selected knowledge base entries),
  skill injection (installed skill system prompts)
]
```

**Phase 4: SDK tool_use Loop**

```
while workflow not completed:
    response = await sdk.messages.create({
      model: master Agent model,
      system: system prompt,
      messages: conversation history,
      tools: [Agent_n2, Agent_n3, ...]
    })

    if response.stop_reason === 'tool_use':
      for each tool_call in response:
        Execute tool (SDK query() subprocess / Bash / Read, etc.)
        Add tool_result to conversation history
    else:
      Workflow completed, extract final output
```

**Phase 5: Completion Handling**

1. Update workflow status to completed
2. Broadcast WebSocket completion event
3. Generate execution report
4. Save final checkpoint

### 4.3 Node Type Execution Logic

| Node | Execution Logic |
|------|-----------------|
| **start** | Pass through user input to downstream |
| **agent** | Master Agent invokes via SDK tool_use loop, executes according to node's configured model/skills/prompt, supports Subagent type and permission inheritance |
| **parallel** | Atomically dispatch multiple Agents in single SDK message, concurrent execution |
| **approval** | Pause execution → WebSocket notify frontend → Wait for user action → resolve/reject |
| **merge** | Collect direct upstream output, merge with `---` separator |
| **subworkflow** | Recursively call another workflow, memory passes back to parent workflow |
| **condition** | Match text in output, route to different branches (true/false) |
| **end** | Aggregate upstream output, generate final result |

---

## 6. Checkpoints and Resume

### 5.1 Checkpoint Storage

After each workflow node completes execution, checkpoint file is immediately written:

```
workspace/<wsId>/.checkpoint/
├── <runId>_<nodeIndex>.json    # One checkpoint file per node
└── <runId>_state.json          # Global execution state
```

Checkpoint contents:
- Node output (for downstream nodes to use)
- Node status (completed / failed / skipped)
- Timestamp
- Model and skill information used

### 5.2 Write Strategy

- **Synchronous Write**: `fs.writeFileSync` ensures data is persisted before crash
- **Save Before Failure**: Even if execution fails, save current checkpoint before throwing error
- **Atomic Write**: Write to temporary file first, then rename to final location

### 5.3 Resume from Breakpoint

```
Server startup
  → Scan workspace/.checkpoint/
  → Discover incomplete runId
  → Mark workflow status as interrupted
  → Frontend displays "Resume" button
  → User clicks resume
  → Load completed checkpoints → Skip completed nodes
  → Continue execution from first pending node
  → Auto-inject saved workflow memory
```

### 5.4 Pause and Resume

| Feature | Implementation |
|---------|----------------|
| Pause Trigger | Frontend sends pause signal → WebSocket → abortSignal |
| Pause Delay | < 5 seconds (stops immediately after current node completes) |
| Resume Method | Use checkpoint, continue from breakpoint |
| Timeout Wait | Pause state maintained for max 30 minutes, auto-terminate on timeout |

---

## 7. Approval and Parallel Nodes

### 7.1 Approval Node

Approval nodes are **intercepted at the orchestrator level**, not dependent on model tool calls:

```
Execution reaches approval node
  → Orchestrator detects approval node (skips model instruction generation)
  → Generate UUID approval ID
  → WebSocket broadcast workflow.approvalRequested event
  → Frontend popup approval dialog (supports reject reason input)
  → Backend creates Promise, waits for user action
  → Timeout protection: configurable (default 1 hour), auto-approve on timeout

User action:
  ├── Approve → Promise resolve → Node marked completed → Continue execution
  └── Reject → Promise resolve (not reject) → Feedback passed to main Agent → Main Agent analyzes reason → Re-execute upstream nodes
```

**Key Design:**
- Approval nodes do not generate Agent instructions (`buildWorkflowInstructions` skips `type === 'approval'`)
- Uses independent approval Map (`_approvalResolvers`), avoiding WorkflowService's reject mechanism causing workflow failure
- On rejection, feedback is passed back to main Agent as user message, allowing retry and modification

**Timeout Configuration:**
- Frontend: Workflow builder → Approval node → Timeout setting (seconds)
- Backend: Reads `node.config.timeout`, defaults to 3600 seconds (1 hour)

### 7.2 Condition Node

Condition nodes use **AI automatic judgment**, not fixed text matching:

```
Execution reaches condition node
  → Read "judgment basis" description
  → Read upstream node output
  → Use lightweight AI model to evaluate condition
  → Return JSON: { pass: boolean, reason: string }
  → Select branch based on result
```

**Configuration:**
- Frontend: Workflow builder → Condition node → "Judgment basis" (textarea)
- Backend: `MasterAgentService.buildSystemPrompt()` injects judgment logic

**Difference from old version:**
| Old Version | New Version |
|-------------|-------------|
| Fixed text matching | AI automatic judgment |
| "Condition match text" input | "Judgment basis" description |
| Exact match | Semantic understanding |

### 7.3 Parallel Nodes

Parallel nodes **atomically dispatch multiple sub-agents** in single tool_use:

```
Execution reaches parallel node
  → TS state machine detects multiple outgoing edges
  → Use Promise.all to call query() in parallel
  → All sub-agents start simultaneously (independent subprocesses)
  → One sub-agent failure doesn't affect other sub-agents
  → After all complete, merge output and pass downstream
```

Key implementation:
- TS state machine directly controls parallel execution
- Uses `Promise.all` for fault tolerance
- Each sub-agent uses independent worktree isolation

---

## 8. Frontend-Backend Communication

### 7.1 Communication Channels

```
┌─────────────────────────────────┐
│           Frontend SPA           │
│                                  │
│  HTTP REST (fetch)  ──────────►  Express Routes
│  WebSocket (ws)     ◄──────────►  WS Server
│  Server-Sent Events  (streaming) │
└─────────────────────────────────┘
```

### 7.2 HTTP REST API

Unified response format:

```json
{
  "success": true,
  "data": { ... },
  "meta": { "total": 100, "page": 1, "limit": 20 }
}
```

Main API endpoints:

| Module | Endpoint | Function |
|--------|----------|----------|
| Agents | `/api/agents` | CRUD + batch delete |
| Workflows | `/api/workflows` | CRUD + execute + snapshot + AI create + flowchart import + batch clone |
| Tasks | `/api/tasks` | CRUD + batch delete |
| Task Queues | `/api/task-queues` | Queue management + batch execution |
| Files | `/api/files` | Browse + read/write + workspace switch |
| Knowledge | `/api/knowledge` | CRUD + search + import/export |
| Memory | `/api/memory` | Read/write + search + shared pool |
| Chat | `/api/chat` | Session management |
| Terminal | `/api/terminal` | PTY session management |
| Skills | `/api/skills` | Install + uninstall + marketplace list |
| MCP | `/api/mcp-tools` | MCP tool management |
| Auth | `/api/auth/key` | API Key retrieval |
| Health | `/api/health` | Service status + CLI compatibility |

### 7.3 WebSocket Broadcast Format

All WebSocket messages use unified `{ type, payload }` format:

```json
{
  "type": "chat.stream",
  "payload": { "sessionId": "...", "chunk": "hello", "done": false }
}
```

### 7.4 WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `chat.stream` | Backend→Frontend | AI chat real-time streaming output |
| `chat.titleUpdated` | Backend→Frontend | Chat title auto-generated |
| `workflow.statusUpdate` | Backend→Frontend | Workflow overall status change |
| `workflow.nodeUpdate` | Backend→Frontend | Single node status update |
| `workflow.approvalRequested` | Backend→Frontend | Approval node waiting for human action |
| `workflow.created/updated/deleted` | Backend→Frontend | Workflow CRUD events |
| `agent.created/updated/deleted` | Backend→Frontend | Agent CRUD events |
| `task.created/updated/deleted` | Backend→Frontend | Task CRUD events |
| `task.completed/failed/progress` | Backend→Frontend | Task execution status |
| `queue.*` | Backend→Frontend | Queue events (start/pause/complete, etc.) |
| `workspace.changed` | Backend→Frontend | Workspace switch notification |
| `client.count` | Backend→Frontend | Online client count |

### 7.5 Streaming Output Handling

```
SDK query() returns message stream
  → Backend parses text blocks from assistant messages
  → WebSocket broadcasts chat.stream events (50ms buffer)
  → Frontend appends to chat window
  → done: true → Load persisted messages
```

### 7.5 WebSocket Reconnection

- Exponential backoff: 1s → 1.5s → 2.25s → ... → 30s (max)
- Max 10 retries
- Auto-trigger `ws:reconnected` event on successful reconnect
- Page components listen to this event, reload latest data
- Heartbeat interval: Client 25 seconds ping, Server 30 seconds timeout

---

## 9. Database Design (Conceptual)

The platform uses **sql.js (pure WASM SQLite)** as persistent storage, zero native dependencies.

### 8.1 Storage Locations

```
data/
├── workflows.sqlite          # Workflow SQLite database
├── prompt-templates.sqlite   # Prompt template SQLite database
├── api-key.json              # API Key (AES-256-GCM encrypted storage)
├── active-workspaces.json    # Registered workspace list
├── current-workspace.json    # Current active workspace path
├── workspace-history.json    # Workspace usage history
├── audit-logs.json           # Audit logs (last 1000 entries)
├── skills/                   # Installed skill status
├── mcp/                      # MCP tool configuration
└── chat-workspace/           # Chat isolated workspace

workspace/<wsId>/
├── .checkpoint/              # Checkpoint files (node-level)
├── .context/                 # Workflow memory
│   ├── {workflow-id}.md
│   └── shared/
│       └── pool.json
├── reports/                  # Execution reports
└── WORKFLOWS/                # Workflow, skill configurations
├── workflows.json            # Workflow definitions
├── knowledge.json            # Knowledge base data
├── tags.json                 # Tags
├── artifact-index.json       # Artifact index
├── chat-sessions.json        # Chat sessions
├── prompt-templates.json     # Prompt templates
├── skills.json               # Installed skills
├── mcp-tools.json            # MCP tool list
├── execution-log.json        # Execution history
└── snapshots/                # Snapshot directory
```

### 8.2 Core Data Models (Conceptual)

**Workflow**
```
id, name, description, workspaceId,
nodes: [{ id, type, config, position }],
edges: [{ source, target }],
status: draft | running | completed | failed | interrupted,
createdAt, updatedAt
```

**Agent**
```
id, name, model (opus|sonnet|haiku), role,
systemPrompt, temperature, toolPermissions,
scope: workspace | global,
status: idle | busy
```

**Task**
```
id, name, workflowId, agentId, workspaceId,
input, priority, status: pending | running | completed | failed,
checkpointFiles, createdAt, completedAt
```

**ExecutionLog**
```
runId, workflowId, status,
nodeResults: [{ nodeId, status, output, startedAt, completedAt }],
startedAt, completedAt
```

**Memory**
```
workflowId, sessions: [{ timestamp, task, summary, files, notes }],
sharedPool: { variables, notes, recentOutputs }
```

---

## 10. Workspace Sandbox and Security

### 9.1 Multi-Layer Security Protection

```
┌─────────────────────────────────────────┐
│ Layer 1: API Authentication              │
│  - API Key auto-generated + AES-256-GCM  │
│  - HTTP: X-API-Key header                │
│  - WebSocket: ?api_key= query parameter  │
├─────────────────────────────────────────┤
│ Layer 2: Three-Tier Rate Limiting        │
│  - Global: 600 requests/minute           │
│  - Write operations: 200 requests/10s    │
│  - Authentication: 10 requests/minute    │
├─────────────────────────────────────────┤
│ Layer 3: Workspace Sandbox               │
│  - --permission-mode acceptEdits         │
│  - System prompt restricts writes to     │
│    workspace                             │
│  - WORKFLOWS directory protection        │
│    (config read/write forbidden)         │
│  - Detect and move back out-of-bounds    │
│    files after execution                 │
├─────────────────────────────────────────┤
│ Layer 4: Path Traversal Prevention       │
│  - resolvePath validates all file paths  │
│  - Reject ../ traversal outside workspace│
├─────────────────────────────────────────┤
│ Layer 5: Agent Memory Sandbox            │
│  - Monitor RSS every 10 seconds          │
│  - Auto-kill process if exceeds 2GB      │
│  - 30-minute execution timeout           │
└─────────────────────────────────────────┘
```

### 9.2 API Key Management

- Supports multiple API Key configurations, users can manage multiple Keys in settings page
- All Keys use AES-256-GCM encrypted storage
- Frontend auto-retrieves Key via `/api/auth/key`
- Auto-excludes `api-key.json` when exporting backup
- Auto-generates random API Key on first startup

---

## 11. Skill Injection Flow

### 10.1 Skill Sources

| Source | Count | Description |
|--------|-------|-------------|
| Anthropic Official Skills | From anthropics/skills | Officially maintained skill collection |
| ECC Community Skills | From affaan-m/ECC | Third-party curated skills |
| Marketplace Total | **Dynamic** | Covering multiple categories |

### 10.2 Installation Mechanism

When installing a skill, the system creates an actual SKILL.md file:

```
User clicks "Install" → SkillService.install()
  → Creates SKILL.md in .claude/skills/{skillId}/ directory
  → SKILL.md contains frontmatter (name, description, user-invocable)
  → SDK subprocess auto-discovers skills in .claude/skills/
```

### 10.3 Injection Flow

```
Agent node preparing to execute
  → Query installed skill list (SkillService.getSkillIdsByAgent)
  → Pass to SDK query() skills option
  → SDK subprocess auto-discovers SKILL.md files in .claude/skills/
  → Skill content injected into agent context
```

### 10.4 Uninstall

- Deletes .claude/skills/{skillId}/ directory
- If other agents still use the skill, keeps the file
- Installation record removed from memory

---

## 12. Memory System

### 12.1 Storage Structure

```
workspace/<wsId>/.context/
├── <workflow-id>.md           # Workflow memory (Markdown format)
├── <workflow-id>.md.bak       # Archive backup
└── shared/
    └── pool.json              # Shared data pool
```

### 12.2 Memory Toggle (memoryEnabled)

**Disabled by default** - memory is only injected when explicitly enabled.

| Configuration | Behavior | Token Cost |
|---------------|----------|------------|
| `memoryEnabled: false` (default) | No memory injection, no execution records saved | 0 |
| `memoryEnabled: true` | Inject history memory, save execution records | ~10,000 tokens |

**Configuration:** Workflow Settings → Memory Settings → Enable Memory Injection

**Design Rationale:**
- Each workflow execution creates a fresh agent (no session reuse)
- Memory is "reference notes", not "conversation history"
- Simple tasks don't need memory, avoiding token waste

### 12.3 Memory Write

Only when `memoryEnabled: true`, after workflow execution completes, system automatically extracts from output:

1. **Output Summary**: Filter noise, extract meaningful core content
2. **Agent Active Memory**: Extract `[记忆: xxx]` or `[Memory: xxx]` markers from output
3. **Task Tags**: Use first 50 characters of task input as tag

Memory format: `## Session {timestamp} | {task tag}`, supports filtering by task keywords.

Deduplication check: If 70%+ lines match previous record, skip write.
Auto-compression: When total length exceeds 15000 characters, keep last 5 complete records, earlier ones keep only titles.

### 12.4 Memory Injection

Only when `memoryEnabled: true`, before sub-agent execution:

```
Current workflow memory (filtered by task keywords, max 10000 characters)
+ Up to 5 sources cross-workflow memory (each max 5000 characters)
+ Up to 3000 characters shared data pool
```

Keyword filtering: Extract Chinese bigrams and English words from task input, exclude common suffixes (notes, tasks, work, etc.), only inject matching memory entries.

### 11.4 Cross-Workflow Memory Transfer

- After sub-workflow execution completes, memory summary passes back to parent workflow
- Shared pool data merges into parent workflow's shared pool
- Configure memorySource to specify inheriting memory from specific workflow

### 11.5 Claude Code Workflows Interoperability

The platform supports bidirectional interoperability with Claude Code's `.md` format workflow files:

**Import (.md → Visual)**:
- Parse frontmatter metadata (`description`, `model`, etc.)
- Parse step list in `## Step N: xxx` format
- Each step maps to an Agent node, auto-connect to generate DAG
- Expand in visual editor, user can manually adjust

**Export (Visual → .md)**:
- Topological sort workflow nodes
- Agent nodes convert to `## Step N: xxx` format
- Preserve node's systemPrompt and model configuration
- Generate standard `.md` file, can be directly placed in `.claude/workflows/` for use

---

## 13. Self-Healing and Fault Tolerance

### 12.1 Error Classification (9 Types)

| Error Type | Identification | Retry Strategy | Auto-Repair |
|------------|----------------|----------------|-------------|
| TOKEN_EXHAUSTED | token + limit/exceed | 30s→60s→120s | Switch to backup model |
| RATE_LIMITED | rate_limit | 5s→15s→45s | Exponential backoff |
| SERVICE_OVERLOADED | overloaded | 10s→30s→90s | Switch to backup model |
| CONTEXT_TOO_LONG | context + length | Standard backoff | Auto-truncate to 70% |
| TIMEOUT | Timeout 30min | Standard backoff | Save checkpoint |
| EXECUTION_ERROR | Unknown | Max 2 times | None |
| AUTH_ERROR | unauthorized | No retry | Prompt user |
| BILLING_ERROR | billing | No retry | Prompt user |
| CLI_NOT_FOUND | ENOENT | No retry | Fallback to SDK mode |

### 12.2 Circuit Breaker

```
5 consecutive failures → Trip for 30 seconds → Half-open probe 2 times
  ├── Success → Resume normal
  └── Failure → Re-trip
```

### 12.3 Model Degradation Chain

```
Opus → Sonnet → Haiku
Unknown model → Haiku (fallback)
```

---

## 14. Data Persistence Mechanism

### 13.1 Three-Layer Protection

| Layer | Mechanism |
|-------|-----------|
| Runtime | setImmediate debounce + synchronous path (writeFileSync) immediate persistence |
| Periodic | Auto-flush all 6 data models every 2 seconds |
| Shutdown/Crash | SIGTERM→7 services flush→exit / uncaughtException→flush→exit(1) |

### 13.2 Data Migration

- Auto-migrate from JSON files on first sql.js access
- JSON files retained as backup after migration
- Recover from `.migrated` backup when SQLite corrupted

### 13.3 Workspace Recovery

- Server restart recovers active workspace from `current-workspace.json`
- `clear() + reload()` completely replaces with workspace data, eliminates old data residue
- `resetStuckNodes()` scans running nodes and marks as interrupted

---

## 15. Technical Parameters Summary

| Parameter | Value |
|-----------|-------|
| Web Server Port | 3000 |
| WebSocket Heartbeat | Client 25 seconds / Server 30 seconds timeout |
| Reconnection | Max 10 times, max 30 seconds interval |
| Agent Execution Timeout | 30 minutes |
| Sub-Agent Memory Limit | 2GB RSS |
| Memory Monitoring Interval | 10 seconds |
| List Pagination | 20 items/page |
| Memory Compression Threshold | 15000 characters |
| Knowledge Injection Limit | 8000 characters |
| Shared Pool Injection Limit | 3000 characters |
| Cross-Workflow Memory Limit | 5 sources / each 5000 characters |
| Approval/Input Timeout | 5 minutes |
| Auto Flush | 2 seconds interval |
| Terminal Session Limit | 10 sessions |
| Circuit Breaker Cooldown | 30 seconds |
| Data Backup | GET export ZIP / POST import |
| Log Rotation | Daily, 30 days cleanup |
| API Key Encryption | AES-256-GCM |
| Persistence Engine | sql.js (WASM SQLite) |
| Subagent Types | 2 types (Explore read-only / general-purpose full) |
| Streaming Mode | All Agents use Anthropic SDK streaming API |
| Permission Inheritance | Sub-agents inherit deny rules from parent Agent |
| System Prompt Inheritance | Sub-agents inherit parent Agent's system prompt |

---

## 16. Feature Modules

Sidebar divided into 4 groups, 16 pages total:

### Core

| Module | Description |
|--------|-------------|
| **Dashboard** | Dashboard: CPU/memory real-time sampling, agent count, active workflows, pending tasks, chat/terminal session count (5 SVG icon stat cards). Supports dark/light theme switching |
| **Agents** | Create and manage AI Agents, configure model (opus/sonnet/haiku aliases), system prompt, temperature, tool permissions, role presets |
| **Workflows** | Visual drag-and-drop orchestration, supports 8 node types (incl. conditional branching), AI creation, batch clone, flowchart import/export, memory transfer, knowledge injection |
| **Files** | Workspace file tree browsing, file preview/edit, create files/folders, workspace management |
| **Tasks** | Create/execute/manage tasks, associate workflows, task queue batch execution, real-time status updates |

### Tools

| Module | Description |
|--------|-------------|
| **Terminal** | xterm.js + node-pty real PTY terminal, multi-session management (max 10), WebSocket real-time output push, auto-opens in current workspace path |
| **Chat** | AI multi-turn conversation, supports model switching, system prompt configuration, session search, default Haiku |

### Data

| Module | Description |
|--------|-------------|
| **Artifact Library** | Auto-index files generated in workspace, real-time change monitoring, supports search, preview, delete |
| **Knowledge Base** | Personal knowledge management, organized by category/tag, full-text search, import/export (JSON/CSV/Markdown) |
| **Memory** | Task tag memory, keyword-filtered injection, cross-workflow transfer, shared data pool, auto-compression |
| **Data Analytics** | Execution statistics, per-workflow statistics, execution timeline view |
| **History** | All workflow execution history, view details/reports, batch delete |
| **Reports** | Execution report viewing and management |

### System

| Module | Description |
|--------|-------------|
| **Marketplace** | Skills marketplace (dynamic) + Workflow templates (13 built-in) |
| **Broadcast** | Event broadcasting and notification management |
| **Settings** | System configuration, preferences, audit logs, prompt templates, API Key management |

---

## 17. Agent Configuration

| Configuration | Description |
|---------------|-------------|
| Model | opus (strongest reasoning) / sonnet (balanced) / haiku (fast lightweight) |
| System Prompt | Defines Agent behavior |
| Temperature | Controls output randomness (0-1) |
| Tool Permissions | Read file, write file, execute command, etc. |
| Role Presets | Developer, Reviewer, Tester, Planner, Debugger, Documenter, Custom |

---

## 18. Workspace Management

### 18.1 Workspace Structure

Each workspace is an independent runtime environment:

```
workspace/<wsId>/
├── WORKFLOWS/          # Workflow, skill configurations
│   ├── workflows.json
│   ├── knowledge.json
│   ├── tags.json
│   ├── artifact-index.json
│   ├── chat-sessions.json
│   ├── prompt-templates.json
│   ├── skills.json
│   ├── mcp-tools.json
│   ├── execution-log.json
│   ├── .checkpoint/    # Per-step checkpoint files
│   └── snapshots/      # Snapshots
├── reports/            # Execution reports
├── .context/           # Workflow memory
│   ├── {workflow-id}.md
│   └── shared/
│       └── pool.json
└── .BACKUP/            # Auto backup (for crash recovery)
```

### 18.2 Workspace Persistence

**Storage Location:** `data/active-workspaces.json`

**Persistence Mechanism:**
- Workspaces are automatically saved to file when activated
- Workspaces are automatically restored on server startup
- Workspaces are removed from list and persisted when deactivated
- Cannot deactivate the last workspace (at least one must remain active)

**Workflow Creation Constraint:**
- Must have an active workspace to create workflows
- Prompts user to activate a workspace if none exists

**Data Structure:**
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

**Implementation:** `WorkspaceManager.ts`
- `init()` - Restore workspaces on startup
- `activate()` - Activate workspace and persist
- `deactivate()` - Deactivate workspace and persist
- `_persist()` - Save to file
- `restoreAll()` - Restore from file

---

## 19. Data Storage

### `data/` Directory (Global Data)

| File | Description |
|------|-------------|
| `agents.json` | Agent configurations |
| `tasks.json` | Global task data |
| `task-queues.json` | Global task queues |
| `chat-sessions.json` | Chat sessions |
| `prompt-templates.json` | Prompt templates |
| `audit-logs.json` | Operation audit logs (last 1000 entries) |
| `api-key.json` | API Key (AES-256-GCM encrypted storage) |
| `active-workspaces.json` | Registered workspace list |
| `current-workspace.json` | Current active workspace path |
| `workspace-history.json` | Workspace usage history |
| `skills/` | Installed skill status |
| `mcp/` | MCP tool configuration |

---

## 20. Security and Authentication

- **API Key Authentication**: Auto-generated on first startup, AES-256-GCM encrypted storage
- **Three-Tier Rate Limiting**: Global 600 requests/minute, write operations 200 requests/10 seconds, authentication 10 requests/minute
- **Workspace Sandbox**: `--permission-mode acceptEdits` restricts writes to workspace
- **Path Traversal Prevention**: All file paths validated via resolvePath
- **Agent Memory Sandbox**: Monitor RSS every 10 seconds, auto-terminate process if exceeds 2GB
- **Tool Whitelist**: Edit/Write (workspace only), Read, Bash (read-only commands), Agent, Glob/Grep
- **Log Persistence**: `logs/app-YYYY-MM-DD.log` daily rotation, auto-cleanup of logs older than 30 days

---

## 21. Error Classification and Adaptive Retry

| Error Type | Backoff Strategy | Auto-Repair | Stop Mechanism |
|------------|------------------|-------------|----------------|
| Token Exhaustion | 30s → 60s → 120s | Switch to backup model | Degraded model also fails → Give up |
| Rate Limit Exceeded | 5s → 15s → 45s | Exponential backoff wait | 3 same type → Give up |
| Service Overload | 10s → 30s → 90s | Switch to backup model | Degraded model also fails → Give up |
| Context Too Long | Standard backoff | Auto-truncate input to 70% | 3 same type → Give up |
| Authentication Failed | No retry | Prompt to fix API Key | Stop immediately |
| Insufficient Balance | No retry | Prompt to recharge | Stop immediately |
| CLI Not Installed | No retry | Fallback to SDK mode | Stop immediately |
| Unknown Error | No retry (max 2 times) | — | 2 same type → Give up |
| Timeout | Standard backoff | Save checkpoint | 3 same type → Give up |

- **Circuit Breaker**: 5 consecutive failures → Trip 30 seconds → Half-open probe → Resume or re-trip
- **Model Degradation Chain**: opus → sonnet → haiku, unknown model → haiku (fallback)

---

## 22. Performance Optimization

| Optimization | Description |
|--------------|-------------|
| Paginated Lazy Loading | Lists default to 20 items, click "Load more" for next page |
| WebSocket Auto-Reconnect | Exponential backoff (max 30 seconds), max 10 retries |
| Client Cache | `Cache` utility class, supports TTL (default 5 minutes) |
| Message Throttling | Dashboard 2 seconds, Task/Agent list 500 milliseconds |
| CPU Real-time Sampling | Two samples (500ms interval) to calculate real usage |
| Async Persistence | Write queue serialization, doesn't block event loop |
| Font Auto-Adapt | Viewport diagonal continuous scaling, 60ms debounce, 70%~100% range |

---

## 23. API Overview

Unified response format:
```json
{ "success": true, "data": { ... }, "meta": { "total": 100, "page": 1, "limit": 20 } }
```

| Module | Endpoint | Description |
|--------|----------|-------------|
| Agents | `/api/agents` | CRUD + batch delete |
| Agent Templates | `/api/agent-templates` | Preset role templates |
| Workflows | `/api/workflows` | CRUD + execute + snapshot + AI create + import/export + batch clone |
| Workflow Templates | `/api/workflow-templates` | Built-in workflow templates |
| Tasks | `/api/tasks` | CRUD + batch delete |
| Task Queues | `/api/task-queues` | Batch task queue management |
| Files | `/api/files` | Browse + read/write + workspace switch |
| Knowledge | `/api/knowledge` | CRUD + search + tags + import/export |
| Memory | `/api/memory` | Read/write + search + shared pool |
| Artifacts | `/api/artifacts` | Index + search + preview + delete |
| Chat | `/api/chat` | Session management + search |
| Terminal | `/api/terminal` | Terminal session + history + recovery |
| Skills | `/api/skills` | Install + uninstall + marketplace list |
| History | `/api/history` | Execution history + batch delete |
| MCP | `/api/mcp-tools` | MCP tool management |
| Prompts | `/api/prompt-templates` | Prompt template CRUD |
| Workspaces | `/api/workspaces` | Workspace CRUD + switch |
| Broadcast | `/api/broadcast` | Event broadcasting |
| Clients | `/api/clients` | Online client management |
| Audit Logs | `/api/audit-logs` | Operation audit query |
| Alerts | `/api/alerts` | Alert management |
| Safety | `/api/safety` | Security audit |
| Reports | `/api/reports` | Execution reports |
| Git | `/api/git` | Git operations |
| Resources | `/api/resources` | System resource monitoring |
| API Keys | `/api/keys` | API Key management |
| Health | `/api/health` | Service status + CLI compatibility |

---

## 24. Batch Scripts

| Script | Description |
|--------|-------------|
| `install.bat` | One-click dependency install |
| `install-global.bat` | Global install (optional) |
| `start.bat` | Start service |
| `stop.bat` | Stop service |
| `restart.bat` | Restart service |
| `logs.bat` | View logs |
| `add-to-startup.bat` | Add to startup |
| `remove-from-startup.bat` | Remove from startup |

---

## 25. Claude Agent SDK Deep Integration (Added 2026-06-01)

### 24.1 Architecture Upgrade Overview

This upgrade transforms the workflow execution engine from "Master Agent orchestration mode" to "TS Hard State Machine Driven mode", completely solving the problem of the main agent lazily simulating sub-agent execution.

**Core Principle:** "Brain belongs to AI, hands and feet belong to code" — TypeScript code directly controls workflow execution, the main agent cannot "pretend to run" sub-agents.

### 24.2 TS Hard State Machine Driven Execution

```
┌─────────────────────────────────────────────────────────────┐
│                    Architecture Comparison                   │
├─────────────────────────────────────────────────────────────┤
│ Old: Main Agent → Call Agent tool → May be lazy, write files │
│ New: TS Code → Directly call query() → Physical subprocess  │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:** `WorkflowService._executeWorkflowStateMachine()`

**Execution Flow:**
1. Parse workflow DAG (nodes and edges)
2. Topological sort to determine execution order
3. Directly call `query()` to execute each node in order
4. Parallel nodes use `Promise.all` for concurrent execution
5. Condition nodes use lightweight AI evaluation
6. Approval nodes suspend via `Promise` waiting for human confirmation

### 24.3 Claude Agent SDK Integration

**Implementation:** `SdkService._executeWithClaudeSdk()`

```typescript
const { query } = require('@anthropic-ai/claude-agent-sdk');

const queryOptions = {
  cwd: workingDir,
  model: resolvedModel,
  systemPrompt: systemPrompt,
  permissionMode: 'bypassPermissions',
  maxTurns: 50,
  allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
  signal: abortController?.signal,  // Physical process control
  env: { ...process.env, ...claudeEnv },
  hooks: {
    PreToolUse: [{ matcher: ".*", callback: async (input) => { ... } }],
    PostToolUse: [{ matcher: ".*", callback: async (input) => { ... } }]
  }
};

for await (const message of query({ prompt, options: queryOptions })) {
  // Process message stream
}
```

### 24.4 PreToolUse Hook Security Interception

**Implementation:** `SdkService._handlePreToolUse()`

**Features:**
- Security interception of dangerous commands (`rm -rf /`, `mkfs`, fork bomb, etc.)
- Approval node support (suspend waiting for human confirmation)
- Real-time broadcast of security check events

```typescript
hooks: {
  PreToolUse: [{
    matcher: ".*",
    callback: async (input) => {
      // Security interception
      if (toolName === 'Bash' && isDangerous(command)) {
        return { hookSpecificOutput: { permissionDecision: 'deny' } };
      }
      // Approval node
      if (needsApproval) {
        return await waitForHumanApproval();
      }
      return { hookSpecificOutput: { permissionDecision: 'allow' } };
    }
  }]
}
```

### 24.5 AbortController.signal Physical Control

**Feature:** Physically terminate subprocesses via OS signals, eliminating zombie processes.

```typescript
const abortController = new AbortController();

// Pass to SDK
query({ options: { signal: abortController.signal } });

// Physical termination
abortController.abort('TIMEOUT');  // or 'ABORTED', 'SHUTDOWN'
```

### 24.6 EventEmitter Real-time Status Reporting

**Implementation:** `SdkService extends EventEmitter`

**Event List:**

| Event | Trigger | Data |
|-------|---------|------|
| `task_started` | Task started | taskId, agentId, model, cwd |
| `progress` | Token-level output | taskId, text |
| `tool_use` | Tool call | taskId, toolName, toolInput, toolUseId |
| `tool_result` | Tool result | taskId, toolUseId, toolResult |
| `completed` | Task completed | taskId, result |
| `failed` | Task failed | taskId, error |
| `security_check` | Security check | taskId, toolName, toolInput |
| `tool_executed` | Tool execution complete | taskId, toolName, toolOutput |
| `autonomous_passed` | Autonomous judgment passed | taskId, attempts |
| `autonomous_failed` | Autonomous judgment failed | taskId, attempts, reason |
| `hitl_approved` | Human approval passed | taskId, attempts |
| `hitl_rejected` | Human approval rejected | taskId, attempts, feedback |

### 24.7 Autonomous Decision Node (Self-Healing)

**Implementation:** `SdkService.executeAutonomousDecisionFlow()`

**Feature:** AI automatically verifies sub-agent output quality, retries if not passing.

```typescript
async executeAutonomousDecisionFlow(taskId, prompt, workspaceRoot, maxAttempts = 3) {
  while (!isPassed && attempts < maxAttempts) {
    // 1. Run sub-agent to generate code
    lastResult = await this._executeWithClaudeSdk(...);

    // 2. Launch evaluator agent to review code
    evalResult = this._parseJsonSafely(evalRaw);

    if (evalResult.pass) {
      isPassed = true;
    } else {
      // 3. Feedback retry
      currentPrompt = `Modify based on feedback: ${evalResult.reason}`;
    }
  }
}
```

### 24.8 Fork-Join Parallel Execution

**Implementation:** `SdkService.executeForkJoinFlow()`

**Feature:** Simultaneously dispatch multiple independent tasks, merge results after completion.

```typescript
async executeForkJoinFlow(tasks, mergePrompt, workspaceRoot) {
  // 1. Serial worktree creation (with lock protection)
  for (const task of tasks) {
    await this._createWorktreeWithLock(task.id, workspaceRoot);
  }

  // 2. Parallel execution of all sub-agents
  const results = await Promise.all(
    tasks.map(task => this._agentLimit(() => this._executeWithClaudeSdk(...)))
  );

  // 3. Merge results
  const finalResult = await this._executeWithClaudeSdk(mergeTaskId, ...);
}
```

### 24.9 HITL Human-in-the-Loop (with Feedback Rollback)

**Implementation:** `SdkService.executeHumanInTheLoopFlow()`

**Feature:** Generate content then wait for human confirmation, regenerate based on feedback if rejected.

```typescript
async executeHumanInTheLoopFlow(taskId, prompt, workspaceRoot) {
  while (!isApproved && attempts < maxAttempts) {
    // 1. Generate content
    lastResult = await this._executeWithClaudeSdk(...);

    // 2. Broadcast approval request
    this.broadcastService.broadcast('workflow.approvalRequested', { ... });

    // 3. Suspend waiting for approval
    const approval = await new Promise((resolve) => {
      this._pendingApprovals.set(approvalId, { resolve });
    });

    if (!approval.approved) {
      feedback = approval.feedback;
    }
  }
}
```

### 24.10 Concurrency Control and Resource Management

| Feature | Implementation | Description |
|---------|----------------|-------------|
| Agent concurrency limit | `pLimit(5)` | Max 5 sub-agents running simultaneously |
| Git operation serial lock | `pLimit(1)` | Prevent worktree lock conflicts |
| JSON safe parsing | `_parseJsonSafely()` | Prevent parsing crashes |
| Graceful shutdown | `shutdownAll()` | Cleanly close all subprocesses |
| Calling tree tracking | `_trackToolCall()` | Cascade call monitoring |

### 24.11 Real-time Tool Call Monitoring

**Implementation:** Parsing `tool_use` blocks from SDK message stream.

```typescript
// Parse tool_use blocks from assistant messages
if (message.type === 'assistant') {
  for (const block of content) {
    if (block.type === 'tool_use') {
      // Real-time tool call capture
      this.emit('tool_use', { taskId, toolName, toolInput, toolUseId });
      this.broadcastService.broadcast('agent.tool_use', { ... });
    }
    if (block.type === 'tool_result') {
      // Real-time tool result capture
      this.emit('tool_result', { taskId, toolUseId, toolResult });
    }
  }
}
```

**Frontend WebSocket Events:**

| Event | Description |
|-------|-------------|
| `agent.tool_use` | Tool call (real-time) |
| `agent.tool_result` | Tool result (real-time) |
| `agent.tool_executed` | Tool execution complete |
| `agent.security_check` | Security check |
| `agent.tool_blocked` | Tool blocked |

### 24.12 Agent Type Mapping

**Claude Agent SDK Supported Types:**

| SDK Type | Permissions | Use Case |
|----------|-------------|----------|
| `Explore` | Read-only | Search, analysis (cannot create files) |
| `general-purpose` | Full | Development, testing, documentation (can create files) |

**System Prompt Auto-inference Logic:**
- Search/analysis tasks → `Explore`
- Development/testing/documentation tasks → `general-purpose`
- Default → `general-purpose`

---

## 26. Double-Loop Architecture (Added 2026-06-03)

### 26.1 Architecture Overview

This upgrade changes the workflow execution engine from "TS state machine direct invocation" to "double-loop architecture", achieving separation between Master Agent coordination and Sub Agent execution.

**Core Principle:** "Tool Chain Physical Disablement" — Master Agent is deprived of all direct tools and can only dispatch Sub Agents via `call_sub_agent`.

### 26.2 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                  Double-Loop Architecture                    │
├─────────────────────────────────────────────────────────────┤
│ Master Agent (Native Anthropic API)                          │
│ ├── tools: [call_sub_agent]  ← Only tool                    │
│ ├── system: System prompt                                    │
│ └── Manual message loop (while + anthropic.messages.create) │
│           ↓                                                  │
│ TS Layer intercepts call_sub_agent                           │
│ ├── executeRoutedStep()                                      │
│ ├── Create worktree isolation                                │
│ └── Call SubAgentRunner                                      │
│           ↓                                                  │
│ Sub Agent (Claude Agent SDK)                                 │
│ ├── query({ prompt, options })                               │
│ ├── allowedTools: [Read, Write, Edit, Bash, ...]            │
│ └── Execute task in worktree                                 │
└─────────────────────────────────────────────────────────────┘
```

### 26.3 Key Implementation

**WorkflowOrchestrator.ts** - Main orchestrator

```typescript
// Manual message loop
while (keepRunning && iteration < maxIterations && !this.stopped) {
  const response = await this.anthropic.messages.create({
    model: resolvedModel,
    system: systemPrompt,
    messages: messages,
    tools: MASTER_TOOLS  // Only call_sub_agent
  });

  const toolCalls = response.content.filter(b => b.type === 'tool_use');

  if (toolCalls.length > 0) {
    // Execute all tool calls in parallel
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

**SubAgentRunner.ts** - Sub Agent process manager

```typescript
// Sub Agent execution
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

// 50ms debounce output
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

### 26.4 Workflow Node Types

| Node Type | Implementation | Description |
|-----------|---------------|-------------|
| start | TS code | Mark complete, pass through input |
| agent | call_sub_agent → SubAgentRunner | AI executes task |
| evaluator | call_sub_agent → SubAgentRunner | AI reviews, returns JSON {pass, reason} |
| approval | request_approval → Promise suspend | Pause for human approval |
| subworkflow | Inline expand sub-workflow nodes | Recursive execution |
| Parallel | Promise.all + multiple tool_use in same turn | Concurrent execution |
| Merge | Wait for upstream output as context | Pass upstream results |
| end | TS code | Summarize final result |

### 26.5 Self-Healing Loop

```
coder creates code
    ↓
evaluator reviews
    ↓
pass = true  → Continue downstream
pass = false → Master calls coder to revise (self-healing loop)
```

### 26.6 Workflow Stop

```typescript
// WorkflowService.stop()
const orchestrator = WorkflowService._activeOrchestrators.get(id);
if (orchestrator) {
  await orchestrator.shutdownAll();  // Stop all Sub Agents
}

// WorkflowOrchestrator.shutdownAll()
this.stopped = true;  // Block new Sub Agent launches
for (const [id, runner] of this.activeRunners) {
  runner.kill();  // Force close Sub Agent
}
```

### 26.7 Session Recovery

```typescript
// Capture session_id
if (message.session_id && !this.sessionId) {
  this.sessionId = message.session_id;
  this.emit('session_captured', { id: this.id, sessionId: this.sessionId });
}

// Persist to file
stateStore.save(`agent:${taskId}`, { sessionId, status: 'running' });

// Crash recovery
if (task.resumeSessionId) {
  queryOptions.resume = task.resumeSessionId;
}
```

---

## 27. Analytics & Statistics System

### 27.1 Execution Statistics

The system automatically tracks execution data for all workflows:

```typescript
// Statistics metrics
{
  total: number;        // Total executions
  completed: number;    // Successful
  failed: number;       // Failed
  successRate: number;  // Success rate (0-100%)
  avgDuration: number;  // Average duration (seconds)
  byWorkflow: Array<{   // Per-workflow stats
    name: string;
    executions: number;
    completed: number;
    failed: number;
    avgDuration: number;
  }>
}
```

### 27.2 Data Persistence

executionLog is force-synced via `_flush()` when workflow completes/fails:

```typescript
// On completion
logEntry.status = 'completed';
logEntry.completedAt = new Date();
WorkflowModel.update(workflowId, { executionLog });
WorkflowModel._flush();  // Force sync write to disk

// On failure
logEntry.status = 'failed';
logEntry.completedAt = new Date();
WorkflowModel.update(workflowId, { executionLog });
WorkflowModel._flush();
```

### 27.3 Crash Recovery

Server auto-repairs stuck `running` execution records on startup:

```typescript
static fixStaleExecutionLogs(): void {
  for (const wf of workflows) {
    for (const log of wf.executionLog) {
      if (log.status === 'running') {
        log.status = 'failed';  // Server restart = abnormal interruption
        log.completedAt = log.startedAt || new Date();
      }
    }
  }
}
```

---

## 28. Task Priority System

### 28.1 Priority Definitions

| Priority | Weight | Description |
|----------|--------|-------------|
| urgent | 4 | Urgent |
| high | 3 | High |
| medium | 2 | Medium (default) |
| low | 1 | Low |

### 28.2 Sorting Algorithm

Task lists are sorted by **priority weight descending + creation time ascending**:

```typescript
const PRIORITY_WEIGHT = { urgent: 4, high: 3, medium: 2, low: 1 };

results.sort((a, b) => {
  // First by priority weight descending
  const weightDiff = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
  if (weightDiff !== 0) return weightDiff;
  // Same priority: FIFO by creation time
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
});
```

### 28.3 Sorting Example

```
[urgent] Fix production bug    ← Executed first
[high]   Develop new feature   ← Second
[medium] Task A (created 10:00) ← Same priority by time
[medium] Task B (created 10:05) ← After A
[low]   Code refactoring       ← Last
```

---

## 29. Workspace Workflow Statistics

### 29.1 Real-time Statistics

Workspace list API reads workflow count from filesystem for each workspace:

```typescript
router.get('/', (req, res) => {
  const workspaces = WorkspaceManager.getActive();

  const enriched = workspaces.map(ws => {
    // Read from WORKFLOWS/workflows.json
    const wfPath = path.join(ws.path, 'WORKFLOWS', 'workflows.json');
    const data = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
    return { ...ws, workflowCount: data.length };
  });

  res.json({ success: true, data: enriched });
});
```

### 29.2 Cross-Workspace Isolation

- Each workspace has independent `WORKFLOWS/workflows.json` file
- Switching workspace doesn't affect other workspace data
- Workflow locks workspace path at start, subsequent execution unaffected by switches

---

## 30. System Resource Monitoring

### 30.1 CPU Usage Calculation

Uses **dual-sample differential** to calculate real-time CPU usage:

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

### 30.2 Auto Refresh

Dashboard system resources auto-refresh every **5 seconds**.

---

## 31. Security Improvements

### 31.1 Command Injection Prevention

When executing commands in AI chat, `shell: true` is disabled and a command whitelist is added:

```typescript
// Only allow read-only commands
const SAFE_COMMANDS = ['ls', 'dir', 'cat', 'type', 'head', 'tail', 'wc', 'grep', 'find', 'echo', 'pwd', 'whoami', 'date', 'env'];

// Parse command and arguments to avoid shell injection
const parts = command.trim().split(/\s+/);
const cmd = parts[0];
const args = parts.slice(1);

spawn(cmd, args, { shell: false });  // Disable shell
```

### 31.2 Concurrent Execution Prevention

Check if workflow is already running before execution:

```typescript
static execute(id: string, ...): ExecuteResult {
  const workflow = WorkflowModel.findById(id);
  
  // Prevent concurrent execution
  if (workflow.executionStatus === 'running') {
    throw new AppError('CONFLICT', `Workflow is running, please wait`, 409);
  }
  
  // ... continue execution
}
```

### 31.3 AI Chat Read-Only Mode

AI chat tools are restricted to read-only:

```typescript
tools: [
  { type: 'web-search' },      // Web search
  { type: 'web-fetch' },       // Fetch web pages
  { type: 'file-read' },       // Read files
  { type: 'file-search' },     // File name search (Glob)
  { type: 'content-search' }   // File content search (Grep)
]
```

### 31.4 Approval Modal Improvements

Approval modal now supports inline comment input:

- Comments are optional when approving
- Reason is required when rejecting
- Uses textarea instead of browser prompt()

---

## 32. Code Quality Improvements

### 32.1 Dead Code Cleanup

Removed approximately 480 lines of unused code:

| Function | Description |
|----------|-------------|
| `_executeMasterAgent` | Old execution method, replaced by Orchestrator |
| `_executeWorkflowStateMachine` | Old state machine method, deprecated |
| `parseSimpleText` | Unused parsing function |
| `StreamProcess` | Unused interface |
| `_activeStreams` | Unused Map |

### 32.2 Analytics Statistics

Execution statistics are force-synced via `_flush()`:

```typescript
logEntry.status = 'completed';
logEntry.completedAt = new Date();
WorkflowModel.update(workflowId, { executionLog });
WorkflowModel._flush();  // Force write to disk
```

### 32.3 Crash Recovery Optimization

Server repairs stuck execution records on startup:

```typescript
static fixStaleExecutionLogs(): void {
  for (const log of workflow.executionLog) {
    if (log.status === 'running') {
      // Has checkpoint → interrupted (resumable)
      // No checkpoint → failed
    }
  }
}
```

---

## 33. Workflow Execution Optimization (2026-06-05)

### 33.1 Remove Worktree Isolation

**Reason:** Worktree isolation prevented downstream nodes from seeing upstream node files, and outputs couldn't be merged back to the main workspace.

**New Architecture:**
```
Workflow starts
    ↓
All sub-agents execute directly in main workspace
    ↓
Workflow ends (outputs already in workspace)
```

**Benefits:**
- Sub-agents naturally share files
- Outputs directly in workspace, no merging needed
- Simpler code, fewer problems

**Notes:**
- When multiple workflows run simultaneously, use prompt to specify folders to avoid conflicts
- Sub-agents can only access files within workspace (security restriction)

### 33.2 Workflow Instruction Generation Optimization

**Problem:** Fork nodes (nodes with multiple downstream) were skipped, directly executing downstream parallel nodes.

**Fix:** Generate current node instruction first, then generate downstream parallel instructions.

```typescript
// Before: only generate downstream node instructions
if (downstream.length > 1) {
  // Generate parallel instructions (skipped current node)
}

// After: generate current node first, then downstream parallel
stepNum++;
steps.push(`Step ${stepNum}: **${node.label}** ...`);
processedNodes.add(nodeId);

if (downstream.length > 1) {
  stepNum++;
  // Generate parallel instructions
}
```

**Execution order example:**
```
n1 (Start) → n3 (Task Planner) → n4 (Frontend) ─┐
                            n5 (Backend) ─┤→ n8 (Reviewer) → n9 (Condition) → n2 (End)
```

### 33.3 Evaluator Read-Only Constraint

**Problem:** Evaluator node's custom prompt overrode system prompt, causing evaluator to write code instead of only evaluating.

**Fix:** Automatically add read-only constraint for evaluator type nodes:

```typescript
if (agentType === 'evaluator') {
  finalTask = `${task}\n\n⚠️ Important constraint: You are only responsible for evaluation and review. Never write test code, modify files, or create new files. Only read existing code and provide review results.`;
}
```

### 33.4 Knowledge Base Persistence

**Problem:** Knowledge base data was only in memory, lost on server restart.

**Fix:** Add local persistence, stored in `WORKFLOWS/knowledge.json`:

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

### 33.5 File Access Restriction

**Security enhancement:** Sub-agents can only access files within workspace.

```typescript
// Check file path in PreToolUse hook
if (pathTools.includes(toolName) && workspaceRoot) {
  const filePath = toolInput?.file_path || toolInput?.path || '';
  if (filePath) {
    const resolved = path.resolve(filePath);
    const normalizedRoot = path.resolve(workspaceRoot);
    if (!resolved.startsWith(normalizedRoot)) {
      logger.warn(`[Security] Denied access to file outside workspace: ${filePath}`);
      return { hookSpecificOutput: { permissionDecision: 'deny' } };
    }
  }
}
```

### 33.6 Workflow Clone Fix

**Problem:** When cloning workflow, `folderPath` was not updated to target workspace path, causing execution to use original workspace.

**Fix:** Set `folderPath` to target workspace path when cloning:

```typescript
const clone = {
  ...wf,
  id: generateId(),
  workspaceId: targetWsId,
  folderPath: targetWs.path,  // Update to target workspace path
  // ...
};
```

### 33.7 Sub-Agent Timeout Adjustment

**Problem:** Default 5-minute timeout too short for complex workflows.

**New timeout settings:**
| Agent Type | Previous | New |
|-----------|----------|-----|
| Default | 5 min | 15 min |
| analyzer | 5 min | 10 min |
| coder | 5 min | 15 min |
| tester | 5 min | 15 min |
| evaluator | 5 min | 10 min |

### 33.8 API Key Detection

**Feature:** Auto-detect API key configuration on startup, show prompt to guide user setup.

- Checks if default API key is configured
- Shows modal with "Configure Now" button if not configured
- Navigates to Settings → API Keys page on button click

---

*Document based on latest git master branch commit*
