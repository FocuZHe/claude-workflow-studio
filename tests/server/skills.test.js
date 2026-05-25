const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../src/server/app');
const { getApiKey } = require('../../src/server/middleware/auth');
const SkillService = require('../../src/server/services/SkillService');

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

describe('Skills API', () => {
  before(async () => {
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  beforeEach(() => {
    SkillService.clear();
  });

  describe('GET /api/skills', () => {
    it('should list all built-in skills', async () => {
      const res = await request('GET', '/api/skills');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length >= 17, `expected at least 17 skills, got ${res.body.data.length}`);
      assert.ok(res.body.data.every(s => s.isBuiltin === true));
    });
  });

  describe('POST /api/skills/:id/install', () => {
    it('should install a skill to an agent', async () => {
      const res = await request('POST', '/api/skills/skill-pdf/install', {
        agentId: 'agent-1'
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.skillId, 'skill-pdf');
      assert.strictEqual(res.body.data.agentId, 'agent-1');
      assert.strictEqual(res.body.data.installed, true);
    });

    it('should accept market skills not in built-in list', async () => {
      const res = await request('POST', '/api/skills/nonexistent/install', {
        agentId: 'agent-1'
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.installed, true);
    });

    it('should return 400 when agentId is missing', async () => {
      const res = await request('POST', '/api/skills/skill-pdf/install', {});

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('should return 409 when skill is already installed', async () => {
      await request('POST', '/api/skills/skill-pdf/install', { agentId: 'agent-1' });
      const res = await request('POST', '/api/skills/skill-pdf/install', { agentId: 'agent-1' });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'CONFLICT');
    });
  });

  describe('GET /api/skills/agent/:agentId', () => {
    it('should return skills installed for an agent', async () => {
      await request('POST', '/api/skills/skill-pdf/install', { agentId: 'agent-1' });
      await request('POST', '/api/skills/skill-docx/install', { agentId: 'agent-1' });

      const res = await request('GET', '/api/skills/agent/agent-1');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.length, 2);
      assert.ok(res.body.data.find(s => s.id === 'skill-pdf'));
      assert.ok(res.body.data.find(s => s.id === 'skill-docx'));
    });

    it('should return empty array for agent with no skills', async () => {
      const res = await request('GET', '/api/skills/agent/agent-none');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.length, 0);
    });
  });

  describe('DELETE /api/skills/:id/uninstall/:agentId', () => {
    it('should uninstall a skill from an agent', async () => {
      await request('POST', '/api/skills/skill-pdf/install', { agentId: 'agent-1' });

      const res = await request('DELETE', '/api/skills/skill-pdf/uninstall/agent-1');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.installed, false);

      // Verify it's uninstalled
      const listRes = await request('GET', '/api/skills/agent/agent-1');
      assert.strictEqual(listRes.body.data.length, 0);
    });

    it('should return 404 when skill not installed for agent', async () => {
      const res = await request('DELETE', '/api/skills/skill-pdf/uninstall/agent-1');

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'NOT_FOUND');
    });

    it('should return 404 when agentId is missing from path', async () => {
      const res = await request('DELETE', '/api/skills/skill-pdf/uninstall');

      assert.strictEqual(res.status, 404);
    });
  });
});
