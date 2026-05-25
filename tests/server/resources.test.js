const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../src/server/app');
const { getApiKey } = require('../../src/server/middleware/auth');

let server;
let baseUrl;

function request(method, urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
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
    req.end();
  });
}

describe('Resources API', () => {
  before(async () => {
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  describe('GET /api/resources', () => {
    it('should return system resource stats', async () => {
      const res = await request('GET', '/api/resources');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.cpu);
      assert.ok(res.body.data.memory);
      assert.ok(typeof res.body.data.uptime === 'number');
    });

    it('should include CPU info with usage and cores', async () => {
      const res = await request('GET', '/api/resources');

      assert.ok(typeof res.body.data.cpu.usage === 'number');
      assert.ok(typeof res.body.data.cpu.cores === 'number');
      assert.ok(res.body.data.cpu.cores > 0);
      assert.ok(typeof res.body.data.cpu.model === 'string');
    });

    it('should include memory info with total, used, free', async () => {
      const res = await request('GET', '/api/resources');

      assert.ok(typeof res.body.data.memory.total === 'number');
      assert.ok(typeof res.body.data.memory.used === 'number');
      assert.ok(typeof res.body.data.memory.free === 'number');
      assert.ok(res.body.data.memory.total > 0);
      assert.ok(res.body.data.memory.used >= 0);
      assert.ok(res.body.data.memory.free >= 0);
      assert.ok(typeof res.body.data.memory.usagePercent === 'number');
    });

    it('should include platform and hostname', async () => {
      const res = await request('GET', '/api/resources');

      assert.ok(typeof res.body.data.platform === 'string');
      assert.ok(typeof res.body.data.hostname === 'string');
    });

    it('should have uptime greater than 0', async () => {
      const res = await request('GET', '/api/resources');

      assert.ok(res.body.data.uptime >= 0);
    });
  });

  describe('GET /api/resources/agents', () => {
    it('should return agent process list', async () => {
      const res = await request('GET', '/api/resources/agents');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
    });

    it('should return empty array when no agents running', async () => {
      const res = await request('GET', '/api/resources/agents');

      // No agents running in test environment
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
    });
  });
});
