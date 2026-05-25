const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../src/server/app');
const { getApiKey } = require('../../src/server/middleware/auth');
const WorkflowModel = require('../../src/server/models/Workflow');

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

describe('History API', () => {
  before(async () => {
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  beforeEach(() => {
    WorkflowModel.clear();
  });

  describe('GET /api/history', () => {
    it('should return empty history when no workflows have execution logs', async () => {
      const res = await request('GET', '/api/history');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.deepStrictEqual(res.body.data.items, []);
      assert.strictEqual(res.body.data.total, 0);
    });

    it('should return execution history from workflow logs', async () => {
      // Create a workflow with execution log
      const workflow = WorkflowModel.create({ name: 'Test WF' });
      WorkflowModel.addExecutionLog(workflow.id, {
        runId: 'run-001',
        startedAt: new Date('2025-01-01T00:00:00Z'),
        completedAt: new Date('2025-01-01T00:01:00Z'),
        status: 'completed',
        nodeResults: []
      });

      const res = await request('GET', '/api/history');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].runId, 'run-001');
      assert.strictEqual(res.body.data.items[0].status, 'completed');
      assert.strictEqual(res.body.data.items[0].workflowName, 'Test WF');
      assert.strictEqual(res.body.data.total, 1);
    });

    it('should filter by status', async () => {
      const workflow = WorkflowModel.create({ name: 'Filter WF' });
      WorkflowModel.addExecutionLog(workflow.id, {
        runId: 'run-ok',
        startedAt: new Date(),
        completedAt: new Date(),
        status: 'completed',
        nodeResults: []
      });
      WorkflowModel.addExecutionLog(workflow.id, {
        runId: 'run-fail',
        startedAt: new Date(),
        completedAt: new Date(),
        status: 'failed',
        nodeResults: []
      });

      const res = await request('GET', '/api/history?status=failed');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].runId, 'run-fail');
    });

    it('should filter by workflowName', async () => {
      const wf1 = WorkflowModel.create({ name: 'Alpha Workflow' });
      const wf2 = WorkflowModel.create({ name: 'Beta Workflow' });
      WorkflowModel.addExecutionLog(wf1.id, { runId: 'r1', startedAt: new Date(), status: 'completed', nodeResults: [] });
      WorkflowModel.addExecutionLog(wf2.id, { runId: 'r2', startedAt: new Date(), status: 'completed', nodeResults: [] });

      const res = await request('GET', '/api/history?workflowName=alpha');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].workflowName, 'Alpha Workflow');
    });

    it('should support pagination', async () => {
      const workflow = WorkflowModel.create({ name: 'Page WF' });
      for (let i = 0; i < 5; i++) {
        WorkflowModel.addExecutionLog(workflow.id, {
          runId: `run-${i}`,
          startedAt: new Date(2025, 0, 1 + i),
          status: 'completed',
          nodeResults: []
        });
      }

      const res = await request('GET', '/api/history?page=1&limit=2');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 2);
      assert.strictEqual(res.body.data.total, 5);
      assert.strictEqual(res.body.data.page, 1);
      assert.strictEqual(res.body.data.limit, 2);
    });
  });

  describe('GET /api/history/:runId', () => {
    it('should return execution detail', async () => {
      const workflow = WorkflowModel.create({ name: 'Detail WF' });
      WorkflowModel.updateNodeStatus(workflow.id, workflow.nodes[0]?.id || 'node1', 'completed', 'output');
      WorkflowModel.addExecutionLog(workflow.id, {
        runId: 'run-detail',
        startedAt: new Date('2025-01-01T00:00:00Z'),
        completedAt: new Date('2025-01-01T00:01:00Z'),
        status: 'completed',
        nodeResults: [{ nodeId: 'node1', status: 'completed', output: 'test', startedAt: new Date(), completedAt: new Date() }]
      });

      const res = await request('GET', '/api/history/run-detail');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.runId, 'run-detail');
      assert.strictEqual(res.body.data.workflowName, 'Detail WF');
    });

    it('should return 404 for non-existent runId', async () => {
      const res = await request('GET', '/api/history/nonexistent');
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe('POST /api/history/:runId/replay', () => {
    it('should return execution context for replay', async () => {
      const workflow = WorkflowModel.create({ name: 'Replay WF' });
      WorkflowModel.addExecutionLog(workflow.id, {
        runId: 'run-replay',
        startedAt: new Date(),
        status: 'completed',
        nodeResults: [{ nodeId: 'n1', status: 'completed', output: 'data' }]
      });

      const res = await request('POST', '/api/history/run-replay/replay');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.runId, 'run-replay');
      assert.ok(res.body.data.context !== undefined);
    });

    it('should return 404 for non-existent runId', async () => {
      const res = await request('POST', '/api/history/nonexistent/replay');
      assert.strictEqual(res.status, 404);
    });
  });
});
