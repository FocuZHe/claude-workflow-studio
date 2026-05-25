const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

// We need to test with API_KEY set, so we set it before requiring the module.
// Since auth.js reads process.env.API_KEY at module load time, we set it first.
const TEST_API_KEY = 'test-secret-key-12345';

describe('Auth Middleware', () => {
  let server;
  let baseUrl;
  let originalApiKey;

  function request(method, urlPath, headers = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, baseUrl);
      const options = {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          ...headers
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

  before(() => {
    originalApiKey = process.env.API_KEY;
    process.env.API_KEY = TEST_API_KEY;

    // Clear require cache so auth.js re-reads the env var
    delete require.cache[require.resolve('../../src/server/middleware/auth')];
    delete require.cache[require.resolve('../../src/server/app')];

    const { createApp } = require('../../src/server/app');
    const { app } = createApp();
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    // Restore original env
    if (originalApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = originalApiKey;
    }
    // Clear cache again so other tests get the default (no key) behavior
    delete require.cache[require.resolve('../../src/server/middleware/auth')];
    delete require.cache[require.resolve('../../src/server/app')];
    return new Promise(resolve => server.close(resolve));
  });

  describe('when API_KEY is set', () => {
    it('should reject requests without API key with 401', async () => {
      const res = await request('GET', '/api/agents');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error.code, 'MISSING_API_KEY');
    });

    it('should reject requests with wrong API key with 403', async () => {
      const res = await request('GET', '/api/agents', { 'X-API-Key': 'wrong-key' });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'INVALID_API_KEY');
    });

    it('should allow requests with correct API key in header', async () => {
      const res = await request('GET', '/api/agents', { 'X-API-Key': TEST_API_KEY });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

    it('should allow requests with correct API key in query parameter', async () => {
      const res = await request('GET', `/api/agents?api_key=${TEST_API_KEY}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

    it('should skip auth for /api/health', async () => {
      const res = await request('GET', '/api/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

    it('should skip auth for non-API paths (static files)', async () => {
      // Request a non-API path; will get 404 from notFoundHandler but NOT 401 from auth
      const res = await request('GET', '/some-static-file.html');
      assert.notStrictEqual(res.status, 401, 'Should not be blocked by auth');
    });
  });
});

describe('Auth Middleware - disabled (no API_KEY)', () => {
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
        headers: { 'Content-Type': 'application/json' }
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

  before(() => {
    // Ensure API_KEY is NOT set
    delete process.env.API_KEY;
    delete require.cache[require.resolve('../../src/server/middleware/auth')];
    delete require.cache[require.resolve('../../src/server/app')];

    const { createApp } = require('../../src/server/app');
    const { app } = createApp();
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    delete require.cache[require.resolve('../../src/server/middleware/auth')];
    delete require.cache[require.resolve('../../src/server/app')];
    return new Promise(resolve => server.close(resolve));
  });

  it('should allow all requests when API_KEY is not set', async () => {
    const res = await request('GET', '/api/agents');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  });
});
