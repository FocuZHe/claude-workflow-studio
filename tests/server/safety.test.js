const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../src/server/app');
const { getApiKey } = require('../../src/server/middleware/auth');

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

describe('Safety API', () => {
  before(async () => {
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  describe('GET /api/safety/stats', () => {
    it('should return safety statistics with correct fields', async () => {
      const res = await request('GET', '/api/safety/stats');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data);
      assert.strictEqual(typeof res.body.data.safeScore, 'number');
      assert.strictEqual(typeof res.body.data.todayThreats, 'number');
      assert.strictEqual(typeof res.body.data.activeRules, 'number');
      assert.strictEqual(typeof res.body.data.blockedRequests, 'number');
    });
  });

  describe('GET /api/safety/threats', () => {
    it('should return threats with pagination', async () => {
      const res = await request('GET', '/api/safety/threats?page=1&limit=10');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.items));
      assert.ok(res.body.data);
      assert.strictEqual(typeof res.body.data.total, 'number');
      assert.strictEqual(res.body.data.page, 1);
      assert.strictEqual(res.body.data.limit, 10);
    });
  });

  describe('GET /api/safety/rules', () => {
    it('should return all security rules', async () => {
      const res = await request('GET', '/api/safety/rules');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
      // Should have default rules
      assert.ok(res.body.data.length > 0);
    });
  });

  describe('POST /api/safety/rules', () => {
    it('should create a new security rule', async () => {
      const newRule = {
        name: 'Test Rule',
        description: 'A test security rule',
        type: 'pattern',
        config: { patterns: ['test-pattern'] },
        enabled: true
      };

      const res = await request('POST', '/api/safety/rules', newRule);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.id);
      assert.strictEqual(res.body.data.name, 'Test Rule');
      assert.strictEqual(res.body.data.type, 'pattern');
      assert.strictEqual(res.body.data.enabled, true);
    });

    it('should reject rule without name', async () => {
      const res = await request('POST', '/api/safety/rules', {
        type: 'pattern'
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe('PUT /api/safety/rules/:id', () => {
    it('should update an existing rule', async () => {
      // First create a rule
      const createRes = await request('POST', '/api/safety/rules', {
        name: 'Rule to Update',
        type: 'pattern'
      });
      const ruleId = createRes.body.data.id;

      // Update it
      const updateRes = await request('PUT', `/api/safety/rules/${ruleId}`, {
        name: 'Updated Rule',
        enabled: false
      });
      assert.strictEqual(updateRes.status, 200);
      assert.strictEqual(updateRes.body.success, true);
      assert.strictEqual(updateRes.body.data.name, 'Updated Rule');
      assert.strictEqual(updateRes.body.data.enabled, false);
    });

    it('should return 404 for non-existent rule', async () => {
      const res = await request('PUT', '/api/safety/rules/non-existent-id', {
        name: 'Updated'
      });
      assert.strictEqual(res.status, 404);
    });
  });

  describe('DELETE /api/safety/rules/:id', () => {
    it('should delete a rule', async () => {
      // First create a rule
      const createRes = await request('POST', '/api/safety/rules', {
        name: 'Rule to Delete',
        type: 'pattern'
      });
      const ruleId = createRes.body.data.id;

      // Delete it
      const deleteRes = await request('DELETE', `/api/safety/rules/${ruleId}`);
      assert.strictEqual(deleteRes.status, 200);
      assert.strictEqual(deleteRes.body.success, true);
      assert.strictEqual(deleteRes.body.data.deleted, true);

      // Verify it's gone
      const getRes = await request('GET', '/api/safety/rules');
      const deletedRule = getRes.body.data.find(r => r.id === ruleId);
      assert.strictEqual(deletedRule, undefined);
    });

    it('should return 404 for non-existent rule', async () => {
      const res = await request('DELETE', '/api/safety/rules/non-existent-id');
      assert.strictEqual(res.status, 404);
    });
  });
});
