const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../src/server/app');
const { getApiKey } = require('../../src/server/middleware/auth');
const McpService = require('../../src/server/services/McpService');

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

describe('MCP Tools API', () => {
  before(async () => {
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  beforeEach(() => {
    McpService.clear();
  });

  describe('GET /api/mcp-tools', () => {
    it('should list all built-in MCP tools', async () => {
      const res = await request('GET', '/api/mcp-tools');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
      assert.strictEqual(res.body.data.length, 0);
    });

    it('should include custom MCP tools in the list', async () => {
      await request('POST', '/api/mcp-tools', {
        name: 'Custom MCP',
        description: 'A custom MCP tool'
      });

      const res = await request('GET', '/api/mcp-tools');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.length, 1);
      const custom = res.body.data.find(t => t.name === 'Custom MCP');
      assert.ok(custom);
      assert.strictEqual(custom.isBuiltin, false);
    });
  });

  describe('POST /api/mcp-tools', () => {
    it('should create a custom MCP tool', async () => {
      const res = await request('POST', '/api/mcp-tools', {
        name: 'My Custom MCP',
        category: '自定义',
        description: 'Custom tool description',
        endpoint: 'http://localhost:8080/mcp',
        auth: { type: 'bearer', token: 'xxx' }
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.id);
      assert.strictEqual(res.body.data.name, 'My Custom MCP');
      assert.strictEqual(res.body.data.isBuiltin, false);
      assert.strictEqual(res.body.data.endpoint, 'http://localhost:8080/mcp');
    });

    it('should reject MCP tool without name', async () => {
      const res = await request('POST', '/api/mcp-tools', {
        description: 'Missing name'
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
    });
  });

  describe('POST /api/mcp-tools/:id/install', () => {
    it('should install an MCP tool to an agent', async () => {
      const res = await request('POST', '/api/mcp-tools/mcp-database/install', {
        agentId: 'agent-1'
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.mcpId, 'mcp-database');
      assert.strictEqual(res.body.data.agentId, 'agent-1');
      assert.strictEqual(res.body.data.installed, true);
    });

    it('should accept market MCP tools not in built-in list', async () => {
      const res = await request('POST', '/api/mcp-tools/nonexistent/install', {
        agentId: 'agent-1'
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.installed, true);
    });

    it('should return 400 when agentId is missing', async () => {
      const res = await request('POST', '/api/mcp-tools/mcp-database/install', {});

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('should return 409 when MCP tool is already installed', async () => {
      await request('POST', '/api/mcp-tools/mcp-database/install', { agentId: 'agent-1' });
      const res = await request('POST', '/api/mcp-tools/mcp-database/install', { agentId: 'agent-1' });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'CONFLICT');
    });

    it('should install a custom MCP tool', async () => {
      const createRes = await request('POST', '/api/mcp-tools', {
        name: 'Custom Tool',
        description: 'A custom tool'
      });
      const customId = createRes.body.data.id;

      const res = await request('POST', `/api/mcp-tools/${customId}/install`, {
        agentId: 'agent-1'
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.mcpId, customId);
    });
  });

  describe('GET /api/mcp-tools/agent/:agentId', () => {
    it('should return MCP tools installed for an agent', async () => {
      await request('POST', '/api/mcp-tools/mcp-database/install', { agentId: 'agent-1' });
      await request('POST', '/api/mcp-tools/mcp-github/install', { agentId: 'agent-1' });

      const res = await request('GET', '/api/mcp-tools/agent/agent-1');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.length, 2);
      assert.ok(res.body.data.find(t => t.id === 'mcp-database'));
      assert.ok(res.body.data.find(t => t.id === 'mcp-github'));
    });

    it('should return empty array for agent with no MCP tools', async () => {
      const res = await request('GET', '/api/mcp-tools/agent/agent-none');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.length, 0);
    });
  });

  describe('DELETE /api/mcp-tools/:id/uninstall', () => {
    it('should uninstall an MCP tool from an agent', async () => {
      await request('POST', '/api/mcp-tools/mcp-database/install', { agentId: 'agent-1' });

      const res = await request('DELETE', '/api/mcp-tools/mcp-database/uninstall', {
        agentId: 'agent-1'
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.installed, false);

      // Verify it's uninstalled
      const listRes = await request('GET', '/api/mcp-tools/agent/agent-1');
      assert.strictEqual(listRes.body.data.length, 0);
    });

    it('should return 404 when MCP tool not installed for agent', async () => {
      const res = await request('DELETE', '/api/mcp-tools/mcp-database/uninstall', {
        agentId: 'agent-1'
      });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'NOT_FOUND');
    });

    it('should return 400 when agentId is missing', async () => {
      const res = await request('DELETE', '/api/mcp-tools/mcp-database/uninstall', {});

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
    });
  });
});
