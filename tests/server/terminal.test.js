const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../src/server/app');
const { getApiKey } = require('../../src/server/middleware/auth');
const TerminalService = require('../../src/server/services/TerminalService');

let server;
let baseUrl;

// Use process.cwd() as fallback cwd since node-pty on Windows (error 267)
// cannot spawn shell in test temp workspace directories that don't fully exist
const DEFAULT_CWD = process.cwd();

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
        'Connection': 'close',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      },
      agent: false  // 禁用 keep-alive，避免 server.close() 挂起
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

describe('Terminal API', () => {
  const activeSessions = [];

  before(async () => {
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => {
    for (const sid of activeSessions) {
      try { TerminalService.killSession(sid); } catch {}
    }
    return new Promise(resolve => server.close(resolve));
  });

  afterEach(() => {
    for (const sid of activeSessions) {
      try { TerminalService.killSession(sid); } catch {}
    }
    activeSessions.length = 0;
  });

  describe('POST /api/terminal', () => {
    it('should create a terminal session', async () => {
      const res = await request('POST', '/api/terminal', { cwd: DEFAULT_CWD });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.id);
      assert.ok(res.body.data.pid);
      assert.strictEqual(res.body.data.status, 'running');
      activeSessions.push(res.body.data.id);
    });

    it('should create session with custom cwd', async () => {
      const res = await request('POST', '/api/terminal', {
        cwd: process.cwd()
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.cwd, process.cwd());
      activeSessions.push(res.body.data.id);
    });
  });

  describe('GET /api/terminal', () => {
    it('should list active sessions', async () => {
      const createRes = await request('POST', '/api/terminal', { cwd: DEFAULT_CWD });
      activeSessions.push(createRes.body.data.id);

      const res = await request('GET', '/api/terminal');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length >= 1);
    });
  });

  describe('DELETE /api/terminal/:id', () => {
    it('should kill a terminal session', async () => {
      const createRes = await request('POST', '/api/terminal', { cwd: DEFAULT_CWD });
      const sessionId = createRes.body.data.id;

      const res = await request('DELETE', `/api/terminal/${sessionId}`);

      assert.strictEqual(res.status, 204);
    });

    it('should return 404 for non-existent session', async () => {
      const res = await request('DELETE', '/api/terminal/nonexistent');

      assert.strictEqual(res.status, 404);
    });
  });

  describe('POST /api/terminal/:id/input', () => {
    it('should return 404 for non-existent session', async () => {
      const res = await request('POST', '/api/terminal/nonexistent/input', {
        data: 'echo hello\n'
      });

      assert.strictEqual(res.status, 404);
    });

    it('should require data field', async () => {
      const createRes = await request('POST', '/api/terminal', { cwd: DEFAULT_CWD });
      activeSessions.push(createRes.body.data.id);

      const res = await request('POST', `/api/terminal/${createRes.body.data.id}/input`, {});

      assert.strictEqual(res.status, 400);
    });
  });

  describe('POST /api/terminal/:id/resize', () => {
    it('should resize an active terminal session', async () => {
      const createRes = await request('POST', '/api/terminal', { cwd: DEFAULT_CWD });
      const sessionId = createRes.body.data.id;
      activeSessions.push(sessionId);

      const res = await request('POST', `/api/terminal/${sessionId}/resize`, {
        cols: 120,
        rows: 40
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

    it('should return 404 for non-existent session', async () => {
      const res = await request('POST', '/api/terminal/nonexistent/resize', {
        cols: 80,
        rows: 24
      });

      assert.strictEqual(res.status, 404);
    });
  });

  describe('GET /api/terminal/:id/output', () => {
    it('should return 404 for non-existent session', async () => {
      const res = await request('GET', '/api/terminal/nonexistent/output');

      assert.strictEqual(res.status, 404);
    });

    it('should return output for active session', async () => {
      const createRes = await request('POST', '/api/terminal', { cwd: DEFAULT_CWD });
      const sessionId = createRes.body.data.id;
      activeSessions.push(sessionId);

      await new Promise(r => setTimeout(r, 200));

      const res = await request('GET', `/api/terminal/${sessionId}/output`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(typeof res.body.data.output === 'string');
    });
  });

  describe('Terminal persistence', () => {
    it('should save session data to disk', () => {
      const session = TerminalService.createSession(DEFAULT_CWD);
      activeSessions.push(session.id);

      TerminalService._saveSessionToDisk(
        TerminalService.getSession(session.id)
      );

      const saved = TerminalService._loadSessionFromDisk(DEFAULT_CWD);
      assert.ok(saved, 'saved data should exist');
      assert.strictEqual(saved.cwd, DEFAULT_CWD);
      assert.ok(Array.isArray(saved.outputBuffer));
      assert.ok(Array.isArray(saved.history));
    });

    it('should load session data from disk', () => {
      // Create session with some output
      const session = TerminalService.createSession(DEFAULT_CWD);
      activeSessions.push(session.id);
      const s = TerminalService.getSession(session.id);
      s.outputBuffer.push('test output line');
      s.history.push({ command: 'test', timestamp: new Date().toISOString() });
      TerminalService._saveSessionToDisk(s);

      const saved = TerminalService._loadSessionFromDisk(DEFAULT_CWD);
      assert.ok(saved);
      assert.ok(saved.outputBuffer.some(line => line.includes('test output line')));
      assert.ok(saved.history.some(h => h.command === 'test'));
    });

    it('should restore session with saved output on createSession', () => {
      const savedData = {
        cwd: DEFAULT_CWD,
        outputBuffer: ['restored output'],
        history: [{ command: 'restored-cmd', timestamp: new Date().toISOString() }],
        createdAt: new Date().toISOString()
      };

      const session = TerminalService.createSession(DEFAULT_CWD, savedData);
      activeSessions.push(session.id);

      const s = TerminalService.getSession(session.id);
      assert.ok(s.outputBuffer.includes('restored output'));
      assert.ok(s.history.some(h => h.command === 'restored-cmd'));
    });

    it('should restore terminals via API with saved output', async () => {
      // First create a session and save data
      const session1 = TerminalService.createSession(DEFAULT_CWD);
      activeSessions.push(session1.id);
      const s = TerminalService.getSession(session1.id);
      s.outputBuffer.push('persisted content');
      TerminalService._saveSessionToDisk(s);

      // Kill it to simulate restart
      TerminalService._sessions.clear();

      // Restore via API
      const restoreRes = await request('POST', '/api/terminal/restore', {
        sessions: [{ title: 'Test Terminal', cwd: DEFAULT_CWD }]
      });

      assert.strictEqual(restoreRes.status, 200);
      assert.ok(restoreRes.body.data.length > 0);
      const restoredId = restoreRes.body.data[0].id;
      activeSessions.push(restoredId);

      // Check output was restored
      const outputRes = await request('GET', `/api/terminal/${restoredId}/output`);
      assert.strictEqual(outputRes.status, 200);
      assert.ok(outputRes.body.data.output.includes('persisted content'));
    });
  });
});
