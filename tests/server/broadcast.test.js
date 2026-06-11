const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../dist/server/app');
const { getApiKey } = require('../../dist/server/middleware/auth');

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

describe('Broadcast API', () => {
  before(async () => {
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  describe('POST /api/broadcast', () => {
    it('should send a broadcast message', async () => {
      const res = await request('POST', '/api/broadcast', {
        message: 'Hello everyone',
        type: 'info'
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(typeof res.body.data.sent === 'number');
    });

    it('should reject broadcast without message', async () => {
      const res = await request('POST', '/api/broadcast', {});

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    it('should reject invalid type', async () => {
      const res = await request('POST', '/api/broadcast', {
        message: 'test',
        type: 'invalid'
      });

      assert.strictEqual(res.status, 400);
    });
  });

  describe('GET /api/broadcast/history', () => {
    it('should return broadcast history', async () => {
      // Send a few broadcasts
      await request('POST', '/api/broadcast', { message: 'Message 1' });
      await request('POST', '/api/broadcast', { message: 'Message 2', type: 'warning' });

      const res = await request('GET', '/api/broadcast/history');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length >= 2);
    });

    it('should support limit parameter', async () => {
      const res = await request('GET', '/api/broadcast/history?limit=1');

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.data.length <= 1);
    });
  });

  describe('GET /api/clients', () => {
    it('should return client info', async () => {
      const res = await request('GET', '/api/clients');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(typeof res.body.data.count === 'number');
      assert.ok(Array.isArray(res.body.data.clients));
    });
  });
});
