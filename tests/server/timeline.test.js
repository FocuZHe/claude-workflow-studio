const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../dist/server/app');
const { getApiKey } = require('../../dist/server/middleware/auth');
const WorkflowModel = require('../../dist/server/models/Workflow');

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

describe('Timeline API', () => {
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

  describe('GET /api/workflows/timeline', () => {
    it('should return empty timeline when no workflows exist', async () => {
      const res = await request('GET', '/api/workflows/timeline');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.deepStrictEqual(res.body.data.items, []);
      assert.strictEqual(res.body.data.total, 0);
    });

    it('should return timeline events from execution logs', async () => {
      // Create a workflow and add execution log entries directly via model
      const createRes = await request('POST', '/api/workflows', { name: 'Timeline WF' });
      const wfId = createRes.body.data.id;

      WorkflowModel.update(wfId, {
        executionLog: [
          {
            runId: 'run-1',
            status: 'completed',
            startedAt: '2026-01-01T10:00:00Z',
            completedAt: '2026-01-01T10:05:00Z'
          },
          {
            runId: 'run-2',
            status: 'failed',
            startedAt: '2026-01-02T10:00:00Z',
            completedAt: '2026-01-02T10:02:00Z'
          }
        ]
      });

      const res = await request('GET', '/api/workflows/timeline');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 2);
      assert.strictEqual(res.body.data.total, 2);

      // Should be sorted by startedAt descending
      assert.strictEqual(res.body.data.items[0].runId, 'run-2');
      assert.strictEqual(res.body.data.items[0].workflowName, 'Timeline WF');
      assert.strictEqual(res.body.data.items[0].duration, 120); // 2 minutes

      assert.strictEqual(res.body.data.items[1].runId, 'run-1');
      assert.strictEqual(res.body.data.items[1].duration, 300); // 5 minutes
    });

    it('should handle pagination', async () => {
      const createRes = await request('POST', '/api/workflows', { name: 'Paginate WF' });
      const wfId = createRes.body.data.id;

      const logs = [];
      for (let i = 0; i < 10; i++) {
        logs.push({
          runId: `run-${i}`,
          status: 'completed',
          startedAt: new Date(2026, 0, i + 1, 10, 0, 0).toISOString(),
          completedAt: new Date(2026, 0, i + 1, 10, 5, 0).toISOString()
        });
      }
      WorkflowModel.update(wfId, { executionLog: logs });

      const res = await request('GET', '/api/workflows/timeline?page=1&limit=3');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 3);
      assert.strictEqual(res.body.data.total, 10);
    });
  });
});

describe('Create-from-text API', () => {
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

  describe('POST /api/workflows/create-from-text', () => {
    it('should create workflow from natural language description', async () => {
      const res = await request('POST', '/api/workflows/create-from-text', {
        description: '搜集资料，分析数据，生成报告'
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.id);
      assert.strictEqual(res.body.data.name, '搜集资料，分析数据，生成报告');
      assert.ok(res.body.data.nodes.length >= 4); // start + 3 steps + end
      assert.ok(res.body.data.edges.length >= 3);
    });

    it('should create workflow with start and end nodes', async () => {
      const res = await request('POST', '/api/workflows/create-from-text', {
        description: '搜索信息'
      });

      assert.strictEqual(res.status, 201);
      const nodes = res.body.data.nodes;
      assert.strictEqual(nodes[0].type, 'start');
      assert.strictEqual(nodes[nodes.length - 1].type, 'end');
    });

    it('should reject request without description', async () => {
      const res = await request('POST', '/api/workflows/create-from-text', {});

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    it('should handle single step description', async () => {
      const res = await request('POST', '/api/workflows/create-from-text', {
        description: '分析代码质量'
      });

      assert.strictEqual(res.status, 201);
      // start + 1 agent node + end = 3 nodes
      assert.strictEqual(res.body.data.nodes.length, 3);
      assert.strictEqual(res.body.data.edges.length, 2);
    });

    it('should generate correct edges for linear flow', async () => {
      const res = await request('POST', '/api/workflows/create-from-text', {
        description: '搜集资料，分析数据'
      });

      const edges = res.body.data.edges;
      // Should connect start -> first step -> second step -> end
      assert.strictEqual(edges[0].source, 'n1'); // start
      assert.strictEqual(edges[edges.length - 1].target, `n${res.body.data.nodes.length - 1 + 1}`); // end is last
    });
  });
});
