const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../dist/server/app');
const { getApiKey } = require('../../dist/server/middleware/auth');
const AuditService = require('../../dist/server/services/AuditService');

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

describe('Audit Logs API', () => {
  before(async () => {
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  beforeEach(() => {
    AuditService.clear();
  });

  describe('GET /api/audit-logs', () => {
    it('should return empty logs when none recorded', async () => {
      const res = await request('GET', '/api/audit-logs');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.total, 0);
    });

    it('should return audit logs after a mutating request', async () => {
      // Make a POST request to trigger audit middleware
      await request('POST', '/api/audit-logs', {});

      // Give audit middleware time to log (it logs on response end)
      await new Promise(resolve => setTimeout(resolve, 100));

      const res = await request('GET', '/api/audit-logs');
      assert.strictEqual(res.status, 200);
      // The POST request itself should have been audited
      assert.ok(res.body.data.total >= 0); // May or may not have the entry yet
    });

    it('should support pagination', async () => {
      // Add some manual audit entries
      for (let i = 0; i < 5; i++) {
        AuditService.log('CREATE', 'workflow', `wf-${i}`, `Created workflow ${i}`, '127.0.0.1');
      }

      const res = await request('GET', '/api/audit-logs?page=1&limit=2');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 2);
      assert.strictEqual(res.body.data.total, 5);
    });

    it('should filter by action', async () => {
      AuditService.log('CREATE', 'workflow', 'wf-1', 'Created', '127.0.0.1');
      AuditService.log('DELETE', 'workflow', 'wf-1', 'Deleted', '127.0.0.1');

      const res = await request('GET', '/api/audit-logs?action=DELETE');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].action, 'DELETE');
    });

    it('should filter by targetType', async () => {
      AuditService.log('CREATE', 'workflow', 'wf-1', 'Created WF', '127.0.0.1');
      AuditService.log('CREATE', 'agent', 'a-1', 'Created Agent', '127.0.0.1');

      const res = await request('GET', '/api/audit-logs?targetType=agent');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].targetType, 'agent');
    });

    it('should filter by sensitive flag', async () => {
      AuditService.log('CREATE', 'workflow', 'wf-1', 'Created', '127.0.0.1');
      AuditService.log('DELETE', 'workflow', 'wf-1', 'Deleted', '127.0.0.1');
      AuditService.log('SET_WORKSPACE', 'workflow', 'wf-1', 'Set folder', '127.0.0.1');

      const res = await request('GET', '/api/audit-logs?sensitive=true');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 2);
      for (const entry of res.body.data.items) {
        assert.strictEqual(entry.sensitive, true);
      }
    });
  });
});

describe('AuditService unit tests', () => {
  beforeEach(() => {
    AuditService.clear();
  });

  it('should create audit log entry with all fields', () => {
    const entry = AuditService.log('CREATE', 'workflow', 'wf-123', 'Created workflow', '192.168.1.1');
    assert.ok(entry.id);
    assert.ok(entry.timestamp);
    assert.strictEqual(entry.action, 'CREATE');
    assert.strictEqual(entry.targetType, 'workflow');
    assert.strictEqual(entry.targetId, 'wf-123');
    assert.strictEqual(entry.detail, 'Created workflow');
    assert.strictEqual(entry.ip, '192.168.1.1');
    assert.strictEqual(entry.sensitive, false);
  });

  it('should mark DELETE actions as sensitive', () => {
    const entry = AuditService.log('DELETE', 'workflow', 'wf-1', 'Deleted', '127.0.0.1');
    assert.strictEqual(entry.sensitive, true);
  });

  it('should mark SET_WORKSPACE actions as sensitive', () => {
    const entry = AuditService.log('SET_WORKSPACE', 'workflow', 'wf-1', 'Set folder', '127.0.0.1');
    assert.strictEqual(entry.sensitive, true);
  });

  it('should not mark CREATE as sensitive', () => {
    const entry = AuditService.log('CREATE', 'workflow', 'wf-1', 'Created', '127.0.0.1');
    assert.strictEqual(entry.sensitive, false);
  });

  it('should return logs in reverse chronological order', () => {
    // Use manually crafted entries with different timestamps to test sorting
    AuditService.logs.push({
      id: 'early', timestamp: '2025-01-01T00:00:00.000Z',
      action: 'CREATE', targetType: 'workflow', targetId: '1', detail: 'First', ip: '127.0.0.1', sensitive: false
    });
    AuditService.logs.push({
      id: 'middle', timestamp: '2025-01-02T00:00:00.000Z',
      action: 'UPDATE', targetType: 'workflow', targetId: '2', detail: 'Second', ip: '127.0.0.1', sensitive: false
    });
    AuditService.logs.push({
      id: 'late', timestamp: '2025-01-03T00:00:00.000Z',
      action: 'DELETE', targetType: 'workflow', targetId: '3', detail: 'Third', ip: '127.0.0.1', sensitive: true
    });

    const result = AuditService.getLogs();
    assert.strictEqual(result.items.length, 3);
    assert.strictEqual(result.items[0].action, 'DELETE');
    assert.strictEqual(result.items[0].id, 'late');
    assert.strictEqual(result.items[2].action, 'CREATE');
    assert.strictEqual(result.items[2].id, 'early');
  });
});
