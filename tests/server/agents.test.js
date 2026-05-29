const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../src/server/app');
const { getApiKey } = require('../../src/server/middleware/auth');
const AgentModel = require('../../src/server/models/Agent');

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

describe('Agent API', () => {
  before(async () => {
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  beforeEach(() => {
    AgentModel.clear();
  });

  describe('POST /api/agents', () => {
    it('should create an agent with valid data', async () => {
      const res = await request('POST', '/api/agents', {
        name: 'Test Agent',
        role: 'developer',
        description: 'A test agent'
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.id);
      assert.strictEqual(res.body.data.name, 'Test Agent');
      assert.strictEqual(res.body.data.role, 'developer');
      assert.strictEqual(res.body.data.status, 'idle');
    });

    it('should create an agent with new fields', async () => {
      const res = await request('POST', '/api/agents', {
        name: 'Enhanced Agent',
        role: 'developer',
        toolPermissions: { readFile: true, writeFile: false, executeCommand: true, browser: false, search: true },
        mcpBindings: [{ server: 'test-server', tools: ['tool1'] }],
        skillNames: ['skill-a', 'skill-b']
      });

      assert.strictEqual(res.status, 201);
      assert.deepStrictEqual(res.body.data.toolPermissions, { readFile: true, writeFile: false, executeCommand: true, browser: false, search: true });
      assert.deepStrictEqual(res.body.data.mcpBindings, [{ server: 'test-server', tools: ['tool1'] }]);
      assert.deepStrictEqual(res.body.data.skillNames, ['skill-a', 'skill-b']);
    });

    it('should use default values for new fields when not provided', async () => {
      const res = await request('POST', '/api/agents', {
        name: 'Default Agent',
        role: 'developer'
      });

      assert.strictEqual(res.status, 201);

      assert.deepStrictEqual(res.body.data.toolPermissions, {
        executeCommand: true, browser: true, search: true
      });
      assert.deepStrictEqual(res.body.data.mcpBindings, []);
      assert.deepStrictEqual(res.body.data.skillNames, []);
    });

    it('should reject agent without name', async () => {
      const res = await request('POST', '/api/agents', {
        role: 'developer'
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('should reject agent without role', async () => {
      const res = await request('POST', '/api/agents', {
        name: 'Test'
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    it('should reject name longer than 50 chars', async () => {
      const res = await request('POST', '/api/agents', {
        name: 'a'.repeat(51),
        role: 'developer'
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    it('should reject invalid role', async () => {
      const res = await request('POST', '/api/agents', {
        name: 'Test',
        role: 'invalid_role'
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe('GET /api/agents', () => {
    it('should return empty list initially', async () => {
      const res = await request('GET', '/api/agents');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.deepStrictEqual(res.body.data.items, []);
      assert.strictEqual(res.body.data.total, 0);
    });

    it('should list created agents', async () => {
      await request('POST', '/api/agents', { name: 'Agent 1', role: 'developer' });
      await request('POST', '/api/agents', { name: 'Agent 2', role: 'tester' });

      const res = await request('GET', '/api/agents');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 2);
      assert.strictEqual(res.body.data.total, 2);
    });

    it('should filter by status', async () => {
      const createRes = await request('POST', '/api/agents', { name: 'Agent 1', role: 'developer' });
      const agentId = createRes.body.data.id;
      await request('PUT', `/api/agents/${agentId}`, { status: 'busy' });
      await request('POST', '/api/agents', { name: 'Agent 2', role: 'tester' });

      const res = await request('GET', '/api/agents?status=busy');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].status, 'busy');
    });

    it('should filter by role', async () => {
      await request('POST', '/api/agents', { name: 'Agent 1', role: 'developer' });
      await request('POST', '/api/agents', { name: 'Agent 2', role: 'tester' });

      const res = await request('GET', '/api/agents?role=developer');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].role, 'developer');
    });

    it('should support pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await request('POST', '/api/agents', { name: `Agent ${i}`, role: 'developer' });
      }

      const res = await request('GET', '/api/agents?page=1&limit=2');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 2);
      assert.strictEqual(res.body.data.total, 5);
      assert.strictEqual(res.body.data.page, 1);
      assert.strictEqual(res.body.data.limit, 2);
    });
  });

  describe('GET /api/agents/:id', () => {
    it('should get agent by id', async () => {
      const createRes = await request('POST', '/api/agents', { name: 'Test', role: 'developer' });
      const agentId = createRes.body.data.id;

      const res = await request('GET', `/api/agents/${agentId}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.id, agentId);
      assert.strictEqual(res.body.data.name, 'Test');
    });

    it('should return 404 for non-existent agent', async () => {
      const res = await request('GET', '/api/agents/nonexistent');

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'NOT_FOUND');
    });
  });

  describe('PUT /api/agents/:id', () => {
    it('should update agent fields', async () => {
      const createRes = await request('POST', '/api/agents', { name: 'Test', role: 'developer' });
      const agentId = createRes.body.data.id;

      const res = await request('PUT', `/api/agents/${agentId}`, {
        name: 'Updated Agent',
        description: 'Updated description'
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.name, 'Updated Agent');
      assert.strictEqual(res.body.data.description, 'Updated description');
    });

    it('should update new agent fields', async () => {
      const createRes = await request('POST', '/api/agents', { name: 'Test', role: 'developer' });
      const agentId = createRes.body.data.id;

      const res = await request('PUT', `/api/agents/${agentId}`, {
        toolPermissions: { readFile: true, writeFile: false, executeCommand: false, browser: true, search: false },
        mcpBindings: [{ server: 'new-server' }],
        skillNames: ['skill-x']
      });

      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.body.data.toolPermissions, { readFile: true, writeFile: false, executeCommand: false, browser: true, search: false });
      assert.deepStrictEqual(res.body.data.mcpBindings, [{ server: 'new-server' }]);
      assert.deepStrictEqual(res.body.data.skillNames, ['skill-x']);
    });

    it('should return 404 for non-existent agent', async () => {
      const res = await request('PUT', '/api/agents/nonexistent', { name: 'Test' });

      assert.strictEqual(res.status, 404);
    });
  });

  describe('DELETE /api/agents/:id', () => {
    it('should delete agent', async () => {
      const createRes = await request('POST', '/api/agents', { name: 'Test', role: 'developer' });
      const agentId = createRes.body.data.id;

      const res = await request('DELETE', `/api/agents/${agentId}`);

      assert.strictEqual(res.status, 204);

      // Verify deleted
      const getRes = await request('GET', `/api/agents/${agentId}`);
      assert.strictEqual(getRes.status, 404);
    });

    it('should return 404 for non-existent agent', async () => {
      const res = await request('DELETE', '/api/agents/nonexistent');

      assert.strictEqual(res.status, 404);
    });
  });

  describe('GET /api/agents/:id/logs', () => {
    it('should return agent logs', async () => {
      const createRes = await request('POST', '/api/agents', { name: 'Test', role: 'developer' });
      const agentId = createRes.body.data.id;

      const res = await request('GET', `/api/agents/${agentId}/logs`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
    });
  });
});
