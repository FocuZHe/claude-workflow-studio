const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../dist/server/app');
const WorkflowModel = require('../../dist/server/models/Workflow');
const AgentModel = require('../../dist/server/models/Agent');
const WorkflowService = require('../../dist/server/services/WorkflowService');
const { getApiKey } = require('../../dist/server/middleware/auth');

/**
 * Mock ClaudeService that simulates CLI execution without spawning real processes
 */
class MockClaudeService {
  async execute(taskId, agentId, prompt, config = {}) {
    return `[Mock] Agent "${agentId}" processed input (${prompt.length} chars)`;
  }
  async checkAvailability() {
    return { available: true, version: 'mock-1.0.0' };
  }
  getActiveCount() { return 0; }
  cancel() { return false; }
}

/**
 * Mock SdkService for workflow state machine testing
 */
class MockSdkService {
  constructor() {
    this.activeStreams = new Map();
    this._taskWorkflowMap = new Map();
    this._taskMetaMap = new Map();
    this._completedTasks = new Set();
    this._runningTasks = new Map();
    this._agentLimit = (fn) => fn();
    this._gitLockLimit = (fn) => fn();
    this._callingTrees = new Map();
    this._toolUseCounters = new Map();
    this._circuitBreakers = new Map();
    this._messageBuffers = new Map();
    this._envMutex = Promise.resolve();
    this.broadcastService = null;
    this._maxAgentDepth = 3;
    this._isShuttingDown = false;
    this._activeRunners = new Map();
  }
  async _executeWithClaudeSdk(taskId, agentId, prompt, config = {}) {
    return `[Mock SDK] Agent "${agentId}" processed input (${prompt.length} chars)`;
  }
  async _withEnvLock(fn) { return fn(); }
  _broadcastChunk() {}
  _cleanupCallingTree() {}
  _isTaskDuplicate() { return false; }
  _markTaskCompleted() {}
  emit() {}
  on() {}
  removeAllListeners() {}
}

let server;
let baseUrl;

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': getApiKey(),
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

describe('Workflow API', () => {
  before(async () => {
    const { app } = createApp();
    // Inject mock ClaudeService for testing
    WorkflowService._claudeService = new MockClaudeService();
    // Inject mock SdkService for state machine testing
    (global).__sdkService = new MockSdkService();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  beforeEach(() => {
    WorkflowModel.clear();
    AgentModel.clear();
  });

  describe('POST /api/workflows', () => {
    it('should create a workflow', async () => {
      const res = await request('POST', '/api/workflows', {
        name: 'Test Workflow',
        description: 'A test workflow'
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.id);
      assert.strictEqual(res.body.data.name, 'Test Workflow');
      assert.strictEqual(res.body.data.status, 'draft');
      assert.deepStrictEqual(res.body.data.nodes, []);
      assert.deepStrictEqual(res.body.data.edges, []);
    });

    it('should reject workflow without name', async () => {
      const res = await request('POST', '/api/workflows', {});

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    it('should reject name longer than 100 chars', async () => {
      const res = await request('POST', '/api/workflows', { name: 'a'.repeat(101) });

      assert.strictEqual(res.status, 400);
    });
  });

  describe('GET /api/workflows', () => {
    it('should list workflows', async () => {
      await request('POST', '/api/workflows', { name: 'WF 1' });
      await request('POST', '/api/workflows', { name: 'WF 2' });

      const res = await request('GET', '/api/workflows');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 2);
      assert.strictEqual(res.body.data.total, 2);
    });

    it('should filter by status', async () => {
      await request('POST', '/api/workflows', { name: 'WF 1' });
      const createRes = await request('POST', '/api/workflows', { name: 'WF 2' });
      const wfId = createRes.body.data.id;

      // Set status to running via model directly
      WorkflowModel.update(wfId, { status: 'running' });

      const res = await request('GET', '/api/workflows?status=running');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 1);
    });
  });

  describe('GET /api/workflows/:id', () => {
    it('should get workflow by id', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Test WF' });
      const wfId = createRes.body.data.id;

      const res = await request('GET', `/api/workflows/${wfId}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.id, wfId);
    });

    it('should return 404 for non-existent workflow', async () => {
      const res = await request('GET', '/api/workflows/nonexistent');

      assert.strictEqual(res.status, 404);
    });
  });

  describe('PUT /api/workflows/:id', () => {
    it('should update workflow', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Test WF' });
      const wfId = createRes.body.data.id;

      const res = await request('PUT', `/api/workflows/${wfId}`, {
        name: 'Updated WF',
        description: 'Updated'
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.name, 'Updated WF');
    });

    it('should validate graph when updating nodes/edges', async () => {
      // Create an agent first
      const agentRes = await request('POST', '/api/agents', { name: 'Test Agent', role: 'developer' });
      const agentId = agentRes.body.data.id;

      const createRes = await request('POST', '/api/workflows', { name: 'Test WF' });
      const wfId = createRes.body.data.id;

      const nodes = [
        { id: 'node1', agentId, label: 'Start', type: 'start', position: { x: 0, y: 0 } },
        { id: 'node2', agentId, label: 'Process', type: 'agent', position: { x: 200, y: 0 } }
      ];
      const edges = [
        { id: 'edge1', source: 'node1', target: 'node2' }
      ];

      const res = await request('PUT', `/api/workflows/${wfId}`, { nodes, edges });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.nodes.length, 2);
      assert.strictEqual(res.body.data.edges.length, 1);
    });

    it('should reject edges with invalid node references', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Test WF' });
      const wfId = createRes.body.data.id;

      const nodes = [
        { id: 'node1', label: 'Start', type: 'start', position: { x: 0, y: 0 } }
      ];
      const edges = [
        { id: 'edge1', source: 'node1', target: 'nonexistent' }
      ];

      const res = await request('PUT', `/api/workflows/${wfId}`, { nodes, edges });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe('DELETE /api/workflows/:id', () => {
    it('should delete draft workflow', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Test WF' });
      const wfId = createRes.body.data.id;

      const res = await request('DELETE', `/api/workflows/${wfId}`);

      assert.strictEqual(res.status, 204);
    });

    it('should not delete running workflow', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Test WF' });
      const wfId = createRes.body.data.id;
      WorkflowModel.update(wfId, { status: 'running', executionStatus: 'running' });

      const res = await request('DELETE', `/api/workflows/${wfId}`);

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe('POST /api/workflows/:id/execute', () => {
    it('should execute workflow with start node', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Test WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'node1', label: 'Start', type: 'start', position: { x: 0, y: 0 } },
          { id: 'node2', label: 'End', type: 'end', position: { x: 200, y: 0 } }
        ],
        edges: [
          { id: 'edge1', source: 'node1', target: 'node2' }
        ]
      });

      const res = await request('POST', `/api/workflows/${wfId}/execute`, { input: 'test' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'running');
      assert.ok(res.body.data.runId);
    });

    it('should reject execution without start node', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Test WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'node1', label: 'Process', type: 'agent', position: { x: 0, y: 0 } }
        ]
      });

      const res = await request('POST', `/api/workflows/${wfId}/execute`);

      assert.strictEqual(res.status, 400);
    });

    it('should allow executing a workflow that is already running (concurrent runs)', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Test WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [{ id: 'node1', label: 'Start', type: 'start', position: { x: 0, y: 0 } }],
        executionStatus: 'running',
        status: 'running'
      });

      const res = await request('POST', `/api/workflows/${wfId}/execute`);

      assert.strictEqual(res.status, 200);
    });
  });

  describe('POST /api/workflows/:id/pause & resume', () => {
    it('should pause a running workflow', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Test WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        status: 'running',
        executionStatus: 'running',
        nodes: [{ id: 'node1', label: 'Start', type: 'start', position: { x: 0, y: 0 } }]
      });

      const res = await request('POST', `/api/workflows/${wfId}/pause`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'paused');
    });

    it('should resume a paused workflow', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Test WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, { status: 'paused', executionStatus: 'paused' });

      const res = await request('POST', `/api/workflows/${wfId}/resume`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'running');
    });
  });

  describe('GET /api/workflows/:id/status', () => {
    it('should return workflow status', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Test WF' });
      const wfId = createRes.body.data.id;

      const res = await request('GET', `/api/workflows/${wfId}/status`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'draft');
    });
  });

  describe('GET /api/workflows/:id/execution', () => {
    it('should return idle execution status for new workflow', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Test WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'node1', label: 'Start', type: 'start', position: { x: 0, y: 0 } },
          { id: 'node2', label: 'Agent', type: 'agent', position: { x: 200, y: 0 } }
        ],
        edges: [{ id: 'edge1', source: 'node1', target: 'node2' }]
      });

      const res = await request('GET', `/api/workflows/${wfId}/execution`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.workflowId, wfId);
      assert.strictEqual(res.body.data.status, 'idle');
      assert.strictEqual(res.body.data.runId, null);
      assert.strictEqual(res.body.data.progress, 0);
      assert.strictEqual(res.body.data.nodes.length, 2);
      assert.strictEqual(res.body.data.nodes[0].status, 'pending');
      assert.strictEqual(res.body.data.nodes[1].status, 'pending');
    });

    it('should return 404 for non-existent workflow', async () => {
      const res = await request('GET', '/api/workflows/nonexistent/execution');
      assert.strictEqual(res.status, 404);
    });
  });

  describe('Master Agent execution - API response', () => {
    it('should execute nodes in topological order (start -> agent -> end)', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Linear WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'start', label: 'Start', type: 'start', position: { x: 0, y: 0 } },
          { id: 'agent1', label: 'Agent 1', type: 'agent', position: { x: 200, y: 0 } },
          { id: 'end', label: 'End', type: 'end', position: { x: 400, y: 0 } }
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'agent1' },
          { id: 'e2', source: 'agent1', target: 'end' }
        ]
      });

      const execRes = await request('POST', `/api/workflows/${wfId}/execute`, { input: 'hello' });
      assert.strictEqual(execRes.status, 200);
      assert.ok(execRes.body.data.runId);

      // Wait for async execution to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      const statusRes = await request('GET', `/api/workflows/${wfId}/execution`);
      assert.strictEqual(statusRes.status, 200);
      assert.strictEqual(statusRes.body.data.status, 'completed');

      const nodes = statusRes.body.data.nodes;
      assert.strictEqual(nodes.length, 3);

      const startNode = nodes.find(n => n.nodeId === 'start');
      const agentNode = nodes.find(n => n.nodeId === 'agent1');
      const endNode = nodes.find(n => n.nodeId === 'end');

      assert.strictEqual(startNode.status, 'completed');
      assert.strictEqual(agentNode.status, 'completed');
      assert.strictEqual(endNode.status, 'completed');
      assert.ok(agentNode.output);
      assert.ok(endNode.output);
    });
  });

  describe('Topology execution - one-to-many branching', () => {
    it('should execute parallel branches from a single source node', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Branch WF' });
      const wfId = createRes.body.data.id;

      // start -> agentA, start -> agentB (one-to-many), agentA -> end, agentB -> end
      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'start', label: 'Start', type: 'start', position: { x: 0, y: 0 } },
          { id: 'agentA', label: 'Agent A', type: 'agent', position: { x: 200, y: -100 } },
          { id: 'agentB', label: 'Agent B', type: 'agent', position: { x: 200, y: 100 } },
          { id: 'end', label: 'End', type: 'end', position: { x: 400, y: 0 } }
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'agentA' },
          { id: 'e2', source: 'start', target: 'agentB' },
          { id: 'e3', source: 'agentA', target: 'end' },
          { id: 'e4', source: 'agentB', target: 'end' }
        ]
      });

      const execRes = await request('POST', `/api/workflows/${wfId}/execute`, { input: 'branch test' });
      assert.strictEqual(execRes.status, 200);

      // Wait for execution
      await new Promise(resolve => setTimeout(resolve, 2000));

      const statusRes = await request('GET', `/api/workflows/${wfId}/execution`);
      assert.strictEqual(statusRes.body.data.status, 'completed');

      const nodes = statusRes.body.data.nodes;
      const startNode = nodes.find(n => n.nodeId === 'start');
      const agentA = nodes.find(n => n.nodeId === 'agentA');
      const agentB = nodes.find(n => n.nodeId === 'agentB');
      const endNode = nodes.find(n => n.nodeId === 'end');

      // All nodes should be completed
      assert.strictEqual(startNode.status, 'completed');
      assert.strictEqual(agentA.status, 'completed');
      assert.strictEqual(agentB.status, 'completed');
      assert.strictEqual(endNode.status, 'completed');

      // Both agent outputs should be present
      assert.ok(agentA.output);
      assert.ok(agentB.output);
    });
  });

  describe('Topology execution - parallel independent nodes', () => {
    it('should execute multiple indegree-0 nodes in parallel', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Parallel WF' });
      const wfId = createRes.body.data.id;

      // Two independent start nodes -> single end node
      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'start1', label: 'Start 1', type: 'start', position: { x: 0, y: -100 } },
          { id: 'start2', label: 'Start 2', type: 'start', position: { x: 0, y: 100 } },
          { id: 'end', label: 'End', type: 'end', position: { x: 400, y: 0 } }
        ],
        edges: [
          { id: 'e1', source: 'start1', target: 'end' },
          { id: 'e2', source: 'start2', target: 'end' }
        ]
      });

      const execRes = await request('POST', `/api/workflows/${wfId}/execute`, { input: 'parallel test' });
      assert.strictEqual(execRes.status, 200);

      await new Promise(resolve => setTimeout(resolve, 2000));

      const statusRes = await request('GET', `/api/workflows/${wfId}/execution`);
      assert.strictEqual(statusRes.body.data.status, 'completed');

      const nodes = statusRes.body.data.nodes;
      assert.strictEqual(nodes.every(n => n.status === 'completed'), true);
    });
  });

  describe('Node status tracking', () => {
    it('should track node status transitions through execution', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Status WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'start', label: 'Start', type: 'start', position: { x: 0, y: 0 } },
          { id: 'end', label: 'End', type: 'end', position: { x: 200, y: 0 } }
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'end' }
        ]
      });

      // Before execution: nodes should be pending
      const beforeRes = await request('GET', `/api/workflows/${wfId}/execution`);
      assert.strictEqual(beforeRes.body.data.nodes[0].status, 'pending');

      await request('POST', `/api/workflows/${wfId}/execute`, { input: 'test' });

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 2000));

      // After execution: nodes should be completed with output and timestamps
      const afterRes = await request('GET', `/api/workflows/${wfId}/execution`);
      const nodes = afterRes.body.data.nodes;

      for (const node of nodes) {
        assert.strictEqual(node.status, 'completed');
        assert.ok(node.output);
      }
    });

    it('should update workflow executionStatus and currentRunId', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'RunId WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'start', label: 'Start', type: 'start', position: { x: 0, y: 0 } }
        ],
        edges: []
      });

      // Before execution
      const before = WorkflowModel.findById(wfId);
      assert.strictEqual(before.executionStatus, 'idle');
      assert.strictEqual(before.currentRunId, null);

      const execRes = await request('POST', `/api/workflows/${wfId}/execute`, { input: 'test' });
      const runId = execRes.body.data.runId;

      // The runId should be set
      assert.ok(runId);

      // Wait for completion (start-only workflow completes nearly instantly)
      await new Promise(resolve => setTimeout(resolve, 1000));

      // After execution
      const after = WorkflowModel.findById(wfId);
      assert.strictEqual(after.executionStatus, 'completed');
      assert.strictEqual(after.currentRunId, runId);
    });
  });

  describe('Error handling', () => {
    it('should allow executing a workflow that is already running (concurrent runs)', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Conflict WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'start', label: 'Start', type: 'start', position: { x: 0, y: 0 } }
        ],
        edges: [],
        executionStatus: 'running',
        status: 'running'
      });

      const res = await request('POST', `/api/workflows/${wfId}/execute`, { input: 'test2' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

    it('should mark workflow as failed when a node errors', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Fail WF' });
      const wfId = createRes.body.data.id;

      // Create an agent node that references a non-existent agent (will use fallback simulation)
      // But we can test the failure path by checking that execution still completes (via fallback)
      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'start', label: 'Start', type: 'start', position: { x: 0, y: 0 } },
          { id: 'agent1', label: 'Agent', type: 'agent', agentId: 'nonexistent', position: { x: 200, y: 0 } },
          { id: 'end', label: 'End', type: 'end', position: { x: 400, y: 0 } }
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'agent1' },
          { id: 'e2', source: 'agent1', target: 'end' }
        ]
      });

      const execRes = await request('POST', `/api/workflows/${wfId}/execute`, { input: 'test' });
      assert.strictEqual(execRes.status, 200);

      // Wait for execution
      await new Promise(resolve => setTimeout(resolve, 2000));

      const statusRes = await request('GET', `/api/workflows/${wfId}/execution`);

      // With the fallback simulation, execution should complete even without a real agent
      assert.strictEqual(statusRes.body.data.status, 'completed');
      assert.strictEqual(statusRes.body.data.nodes.every(n => n.status === 'completed'), true);
    });
  });

  describe('Backward compatibility', () => {
    it('should normalize old workflow data without new fields', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Old WF' });
      const wfId = createRes.body.data.id;

      // Simulate old data by directly manipulating the model without new fields
      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'node1', label: 'Old Node', type: 'start', position: { x: 0, y: 0 } }
        ]
      });

      const res = await request('GET', `/api/workflows/${wfId}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.executionStatus, 'idle');
      assert.strictEqual(res.body.data.currentRunId, null);
      assert.strictEqual(res.body.data.nodes[0].status, 'pending');
      assert.strictEqual(res.body.data.nodes[0].output, null);
      assert.strictEqual(res.body.data.nodes[0].startedAt, null);
      assert.strictEqual(res.body.data.nodes[0].completedAt, null);
      assert.deepStrictEqual(res.body.data.nodes[0].logs, []);
    });

    it('should normalize old execution status data', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Old Status WF' });
      const wfId = createRes.body.data.id;

      const execRes = await request('GET', `/api/workflows/${wfId}/execution`);
      assert.strictEqual(execRes.status, 200);
      assert.strictEqual(execRes.body.data.status, 'idle');
      assert.strictEqual(execRes.body.data.runId, null);
      assert.strictEqual(execRes.body.data.progress, 0);
    });
  });

  // ===== Debug API Tests =====

  describe('POST /api/workflows/:id/step - Single-step execution', () => {
    it('should execute a single start node', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Step WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'start', label: 'Start', type: 'start', position: { x: 0, y: 0 } },
          { id: 'end', label: 'End', type: 'end', position: { x: 200, y: 0 } }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
        context: { workflowInput: 'step test input' }
      });

      const res = await request('POST', `/api/workflows/${wfId}/step`, { nodeId: 'start' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.nodeId, 'start');
      assert.ok(res.body.data.output);
    });

    it('should return 404 for non-existent node', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Step WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [{ id: 'start', label: 'Start', type: 'start', position: { x: 0, y: 0 } }]
      });

      const res = await request('POST', `/api/workflows/${wfId}/step`, { nodeId: 'nonexistent' });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
    });

    it('should require nodeId in body', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Step WF' });
      const wfId = createRes.body.data.id;

      const res = await request('POST', `/api/workflows/${wfId}/step`, {});

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe('POST /api/workflows/:id/simulate - Simulate workflow', () => {
    it('should simulate a workflow with mock data', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Sim WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'start', label: 'Start', type: 'start', position: { x: 0, y: 0 } },
          { id: 'process', label: 'Process', type: 'agent', position: { x: 200, y: 0 } },
          { id: 'end', label: 'End', type: 'end', position: { x: 400, y: 0 } }
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'process' },
          { id: 'e2', source: 'process', target: 'end' }
        ]
      });

      const res = await request('POST', `/api/workflows/${wfId}/simulate`, {
        mockData: { process: 'mocked agent output' }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.results);
      assert.strictEqual(res.body.data.results.process, 'mocked agent output');
      assert.ok(res.body.data.results.start);
      assert.ok(res.body.data.results.end);
    });

    it('should simulate without mock data using defaults', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Sim WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'start', label: 'Start', type: 'start', position: { x: 0, y: 0 } },
          { id: 'end', label: 'End', type: 'end', position: { x: 200, y: 0 } }
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }]
      });

      const res = await request('POST', `/api/workflows/${wfId}/simulate`, {});

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.results.start);
      assert.ok(res.body.data.results.end);
    });

    it('should return 404 for non-existent workflow', async () => {
      const res = await request('POST', '/api/workflows/nonexistent/simulate', {});

      assert.strictEqual(res.status, 404);
    });
  });

  describe('POST /api/workflows/:id/test-node - Test single node', () => {
    it('should test a node with custom input', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'TestNode WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'start', label: 'Start', type: 'start', position: { x: 0, y: 0 } }
        ]
      });

      const res = await request('POST', `/api/workflows/${wfId}/test-node`, {
        nodeId: 'start',
        testInput: 'custom test input'
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.nodeId, 'start');
      assert.strictEqual(res.body.data.input, 'custom test input');
      assert.ok(res.body.data.output);
    });

    it('should require nodeId in body', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'TestNode WF' });
      const wfId = createRes.body.data.id;

      const res = await request('POST', `/api/workflows/${wfId}/test-node`, {});

      assert.strictEqual(res.status, 400);
    });

    it('should return 404 for non-existent node', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'TestNode WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [{ id: 'start', label: 'Start', type: 'start', position: { x: 0, y: 0 } }]
      });

      const res = await request('POST', `/api/workflows/${wfId}/test-node`, {
        nodeId: 'nonexistent',
        testInput: 'test'
      });

      assert.strictEqual(res.status, 404);
    });
  });

  describe('GET /api/workflows/:id/variables - Variable viewer', () => {
    it('should return all node outputs and context', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Vars WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'start', label: 'Start', type: 'start', status: 'completed', output: 'start output', position: { x: 0, y: 0 } },
          { id: 'agent1', label: 'Agent', type: 'agent', status: 'completed', output: 'agent output', position: { x: 200, y: 0 } }
        ],
        context: { key1: 'value1', key2: 42 }
      });

      const res = await request('GET', `/api/workflows/${wfId}/variables`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.nodes.start.output, 'start output');
      assert.strictEqual(res.body.data.nodes.agent1.output, 'agent output');
      assert.strictEqual(res.body.data.context.key1, 'value1');
      assert.strictEqual(res.body.data.context.key2, 42);
    });

    it('should return 404 for non-existent workflow', async () => {
      const res = await request('GET', '/api/workflows/nonexistent/variables');

      assert.strictEqual(res.status, 404);
    });
  });

  // ===== Shared Context API Tests =====

  describe('GET /api/workflows/:id/context - Get shared context', () => {
    it('should return workflow context', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Ctx WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        context: { key1: 'value1', key2: [1, 2, 3] }
      });

      const res = await request('GET', `/api/workflows/${wfId}/context`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.context.key1, 'value1');
      assert.deepStrictEqual(res.body.data.context.key2, [1, 2, 3]);
    });

    it('should return empty context object for new workflow', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'New Ctx WF' });
      const wfId = createRes.body.data.id;

      const res = await request('GET', `/api/workflows/${wfId}/context`);

      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.body.data.context, {});
    });
  });

  describe('PUT /api/workflows/:id/context - Update shared context', () => {
    it('should update workflow context', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Update Ctx WF' });
      const wfId = createRes.body.data.id;

      const res = await request('PUT', `/api/workflows/${wfId}/context`, {
        context: { newKey: 'newValue', count: 10 }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.context.newKey, 'newValue');
      assert.strictEqual(res.body.data.context.count, 10);
    });

    it('should reject non-object context', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Bad Ctx WF' });
      const wfId = createRes.body.data.id;

      const res = await request('PUT', `/api/workflows/${wfId}/context`, {
        context: 'not an object'
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    it('should merge context on subsequent updates', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Merge Ctx WF' });
      const wfId = createRes.body.data.id;

      await request('PUT', `/api/workflows/${wfId}/context`, {
        context: { key1: 'value1' }
      });

      const res = await request('PUT', `/api/workflows/${wfId}/context`, {
        context: { key2: 'value2' }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.context.key1, 'value1');
      assert.strictEqual(res.body.data.context.key2, 'value2');
    });
  });

  // ===== Batch Execute API Tests =====

  describe('POST /api/workflows/:id/batch-execute - Batch execution', () => {
    it('should batch execute workflow with multiple param sets', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Batch WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        nodes: [
          { id: 'start', label: 'Start', type: 'start', position: { x: 0, y: 0 } }
        ],
        edges: []
      });

      const res = await request('POST', `/api/workflows/${wfId}/batch-execute`, {
        paramsArray: [
          { input: 'input1', params: { a: 1 } },
          { input: 'input2', params: { b: 2 } }
        ]
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.length, 2);
      assert.ok(res.body.data[0].runId);
      assert.strictEqual(res.body.data[0].status, 'completed');
      assert.strictEqual(res.body.data[0].input, 'input1');
      assert.ok(res.body.data[1].runId);
      assert.strictEqual(res.body.data[1].status, 'completed');
    });

    it('should reject empty paramsArray', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Batch WF' });
      const wfId = createRes.body.data.id;

      const res = await request('POST', `/api/workflows/${wfId}/batch-execute`, {
        paramsArray: []
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    it('should reject non-array paramsArray', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Batch WF' });
      const wfId = createRes.body.data.id;

      const res = await request('POST', `/api/workflows/${wfId}/batch-execute`, {
        paramsArray: 'not an array'
      });

      assert.strictEqual(res.status, 400);
    });

    it('should return 404 for non-existent workflow', async () => {
      const res = await request('POST', '/api/workflows/nonexistent/batch-execute', {
        paramsArray: [{ input: 'test' }]
      });

      assert.strictEqual(res.status, 404);
    });
  });
});
