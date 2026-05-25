const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../src/server/app');
const { getApiKey } = require('../../src/server/middleware/auth');
const AlertService = require('../../src/server/services/AlertService');

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

describe('Alerts API', () => {
  before(async () => {
    AlertService.config.failureAlert = true;
    AlertService.config.longRunningThreshold = 300000;
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  describe('GET /api/alerts/config', () => {
    it('should return default alert config', async () => {
      const res = await request('GET', '/api/alerts/config');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.failureAlert, true);
      assert.strictEqual(res.body.data.longRunningThreshold, 300000);
    });
  });

  describe('PUT /api/alerts/config', () => {
    it('should update alert config', async () => {
      const res = await request('PUT', '/api/alerts/config', {
        failureAlert: false,
        longRunningThreshold: 600000
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.failureAlert, false);
      assert.strictEqual(res.body.data.longRunningThreshold, 600000);

      // Reset
      await request('PUT', '/api/alerts/config', {
        failureAlert: true,
        longRunningThreshold: 300000
      });
    });

    it('should reject invalid longRunningThreshold', async () => {
      const res = await request('PUT', '/api/alerts/config', {
        longRunningThreshold: -1
      });
      assert.strictEqual(res.status, 400);
    });
  });
});

describe('AlertService unit tests', () => {
  beforeEach(() => {
    AlertService.config.failureAlert = true;
    AlertService.config.longRunningThreshold = 300000;
  });

  it('should return null when failureAlert is disabled', () => {
    AlertService.config.failureAlert = false;
    const result = AlertService.checkWorkflowStatus(
      { id: '1', name: 'test', executionStatus: 'failed' },
      { broadcast: () => {} }
    );
    assert.strictEqual(result, null);
  });

  it('should broadcast alert on workflow failure', () => {
    let broadcasted = null;
    const mockBroadcast = { broadcast: (event, data) => { broadcasted = { event, data }; } };

    const result = AlertService.checkWorkflowStatus(
      { id: 'wf-1', name: 'Test WF', executionStatus: 'failed' },
      mockBroadcast
    );

    assert.ok(result);
    assert.strictEqual(result.type, 'workflow_failure');
    assert.strictEqual(result.level, 'error');
    assert.strictEqual(broadcasted.event, 'alert.notification');
  });

  it('should not alert for non-failed workflow', () => {
    const result = AlertService.checkWorkflowStatus(
      { id: '1', name: 'test', executionStatus: 'running' },
      { broadcast: () => {} }
    );
    assert.strictEqual(result, null);
  });

  it('should alert on long-running workflow', () => {
    const fiveMinutesAgo = new Date(Date.now() - 400000);
    let broadcasted = null;
    const mockBroadcast = { broadcast: (event, data) => { broadcasted = { event, data }; } };

    const result = AlertService.checkLongRunning(
      {
        id: 'wf-1', name: 'Slow WF',
        executionStatus: 'running',
        executionLog: [{ runId: 'r1', startedAt: fiveMinutesAgo }]
      },
      mockBroadcast
    );

    assert.ok(result);
    assert.strictEqual(result.type, 'long_running');
    assert.strictEqual(result.level, 'warn');
    assert.ok(broadcasted);
  });

  it('should not alert on short-running workflow', () => {
    const justNow = new Date();
    const result = AlertService.checkLongRunning(
      {
        id: 'wf-1', name: 'Fast WF',
        executionStatus: 'running',
        executionLog: [{ runId: 'r1', startedAt: justNow }]
      },
      { broadcast: () => {} }
    );
    assert.strictEqual(result, null);
  });

  it('should update config correctly', () => {
    AlertService.updateConfig({ failureAlert: false, longRunningThreshold: 120000 });
    const updated = AlertService.getConfig();
    assert.strictEqual(updated.failureAlert, false);
    assert.strictEqual(updated.longRunningThreshold, 120000);
  });
});
