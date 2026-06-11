const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../dist/server/app');
const { getApiKey } = require('../../dist/server/middleware/auth');
const AgentTemplateService = require('../../dist/server/services/AgentTemplateService');

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

describe('Agent Template API', () => {
  before(async () => {
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  beforeEach(() => {
    AgentTemplateService.clear();
  });

  describe('GET /api/agent-templates', () => {
    it('should list all built-in templates', async () => {
      const res = await request('GET', '/api/agent-templates');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
      // Should have 7 built-in templates
      assert.strictEqual(res.body.data.length, 7);
      // Check that all are marked as built-in
      assert.ok(res.body.data.every(t => t.isBuiltin === true));
    });

    it('should include custom templates in the list', async () => {
      // Create a custom template
      await request('POST', '/api/agent-templates', {
        name: 'Custom Template',
        role: 'developer',
        description: 'A custom template'
      });

      const res = await request('GET', '/api/agent-templates');

      assert.strictEqual(res.status, 200);
      // 7 built-in + 1 custom
      assert.strictEqual(res.body.data.length, 8);
      const custom = res.body.data.find(t => t.name === 'Custom Template');
      assert.ok(custom);
      assert.strictEqual(custom.isBuiltin, false);
    });
  });

  describe('POST /api/agent-templates', () => {
    it('should create a custom template', async () => {
      const res = await request('POST', '/api/agent-templates', {
        name: 'My Custom Template',
        role: 'developer',
        description: 'Custom description',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'Custom system prompt',
        temperature: 0.6
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.id);
      assert.strictEqual(res.body.data.name, 'My Custom Template');
      assert.strictEqual(res.body.data.role, 'developer');
      assert.strictEqual(res.body.data.isBuiltin, false);
    });

    it('should reject template without name', async () => {
      const res = await request('POST', '/api/agent-templates', {
        role: 'developer'
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('should reject template with name conflicting with built-in', async () => {
      const res = await request('POST', '/api/agent-templates', {
        name: '🏗️ 架构师'
      });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'CONFLICT');
    });
  });

  describe('DELETE /api/agent-templates/:id', () => {
    it('should delete a custom template', async () => {
      const createRes = await request('POST', '/api/agent-templates', {
        name: 'To Delete',
        role: 'developer'
      });
      const templateId = createRes.body.data.id;

      const res = await request('DELETE', `/api/agent-templates/${templateId}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // Verify it's gone from the list
      const listRes = await request('GET', '/api/agent-templates');
      const found = listRes.body.data.find(t => t.id === templateId);
      assert.strictEqual(found, undefined);
    });

    it('should return 404 for non-existent template', async () => {
      const res = await request('DELETE', '/api/agent-templates/nonexistent');

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'NOT_FOUND');
    });

    it('should not allow deleting built-in templates', async () => {
      const res = await request('DELETE', '/api/agent-templates/tpl-architect');

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });
  });
});
