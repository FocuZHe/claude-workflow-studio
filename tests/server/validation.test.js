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

describe('Validation Middleware', () => {
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

  describe('Response Format', () => {
    it('should return consistent success format', async () => {
      const res = await request('POST', '/api/agents', {
        name: 'Test',
        role: 'developer'
      });

      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data !== undefined);
    });

    it('should return consistent error format', async () => {
      const res = await request('POST', '/api/agents', {});

      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error);
      assert.ok(res.body.error.code);
      assert.ok(res.body.error.message);
    });

    it('should return meta for list endpoints', async () => {
      const res = await request('GET', '/api/agents');

      assert.ok(res.body.data);
      assert.ok(typeof res.body.data.total === 'number');
      assert.ok(typeof res.body.data.page === 'number');
      assert.ok(typeof res.body.data.limit === 'number');
    });
  });

  describe('Agent Validation', () => {
    it('should reject empty name', async () => {
      const res = await request('POST', '/api/agents', { name: '', role: 'developer' });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('should reject name with only spaces', async () => {
      const res = await request('POST', '/api/agents', { name: '   ', role: 'developer' });

      assert.strictEqual(res.status, 400);
    });

    it('should trim name whitespace', async () => {
      const res = await request('POST', '/api/agents', { name: '  Test  ', role: 'developer' });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.name, 'Test');
    });

    it('should reject description over 500 chars', async () => {
      const res = await request('POST', '/api/agents', {
        name: 'Test',
        role: 'developer',
        description: 'a'.repeat(501)
      });

      assert.strictEqual(res.status, 400);
    });

    it('should accept all valid roles', async () => {
      const roles = ['developer', 'reviewer', 'tester', 'planner', 'custom'];

      for (const role of roles) {
        const res = await request('POST', '/api/agents', { name: `Agent ${role}`, role });
        assert.strictEqual(res.status, 201, `Role ${role} should be accepted`);
      }
    });

    it('should reject invalid status on update', async () => {
      const createRes = await request('POST', '/api/agents', { name: 'Test', role: 'developer' });
      const agentId = createRes.body.data.id;

      const res = await request('PUT', `/api/agents/${agentId}`, { status: 'invalid' });

      assert.strictEqual(res.status, 400);
    });

    it('should accept all valid statuses', async () => {
      const createRes = await request('POST', '/api/agents', { name: 'Test', role: 'developer' });
      const agentId = createRes.body.data.id;

      const statuses = ['idle', 'busy', 'error', 'offline'];
      for (const status of statuses) {
        const res = await request('PUT', `/api/agents/${agentId}`, { status });
        assert.strictEqual(res.status, 200, `Status ${status} should be accepted`);
      }
    });
  });

  describe('Pagination Validation', () => {
    it('should default page and limit', async () => {
      const res = await request('GET', '/api/agents');

      assert.strictEqual(res.body.data.page, 1);
      assert.strictEqual(res.body.data.limit, 20);
    });

    it('should reject page < 1', async () => {
      const res = await request('GET', '/api/agents?page=0');

      assert.strictEqual(res.status, 400);
    });

    it('should reject limit > 100', async () => {
      const res = await request('GET', '/api/agents?limit=101');

      assert.strictEqual(res.status, 400);
    });

    it('should reject limit < 1', async () => {
      const res = await request('GET', '/api/agents?limit=0');

      assert.strictEqual(res.status, 400);
    });
  });

  describe('Task Validation', () => {
    it('should reject title over 200 chars', async () => {
      const res = await request('POST', '/api/tasks', { title: 'a'.repeat(201) });

      assert.strictEqual(res.status, 400);
    });

    it('should reject description over 2000 chars', async () => {
      const res = await request('POST', '/api/tasks', {
        title: 'Test',
        description: 'a'.repeat(2001)
      });

      assert.strictEqual(res.status, 400);
    });

    it('should accept all valid priorities', async () => {
      const priorities = ['low', 'medium', 'high', 'urgent'];
      for (const priority of priorities) {
        const res = await request('POST', '/api/tasks', { title: `Task ${priority}`, priority });
        assert.strictEqual(res.status, 201, `Priority ${priority} should be accepted`);
      }
    });
  });

  describe('Workflow Validation', () => {
    it('should reject name over 100 chars', async () => {
      const res = await request('POST', '/api/workflows', { name: 'a'.repeat(101) });

      assert.strictEqual(res.status, 400);
    });

    it('should reject description over 1000 chars', async () => {
      const res = await request('POST', '/api/workflows', {
        name: 'Test',
        description: 'a'.repeat(1001)
      });

      assert.strictEqual(res.status, 400);
    });
  });

  describe('404 Handler', () => {
    it('should return 404 for unknown API routes', async () => {
      const res = await request('GET', '/api/nonexistent');

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'NOT_FOUND');
    });
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const res = await request('GET', '/api/health');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, 'ok');
      assert.ok(typeof res.body.data.uptime === 'number');
    });
  });
});
