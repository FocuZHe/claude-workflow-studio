const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../src/server/app');
const { getApiKey } = require('../../src/server/middleware/auth');
const WorkflowTemplateService = require('../../src/server/services/WorkflowTemplateService');
const WorkflowModel = require('../../src/server/models/Workflow');

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

describe('Workflow Templates API', () => {
  before(async () => {
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  beforeEach(() => {
    WorkflowTemplateService.clear();
    WorkflowModel.clear();
  });

  describe('GET /api/workflow-templates', () => {
    it('should list all built-in templates', async () => {
      const res = await request('GET', '/api/workflow-templates');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
      assert.strictEqual(res.body.data.length, 22);
      assert.ok(res.body.data.every(t => t.isBuiltin === true));
    });

    it('should filter templates by category', async () => {
      const res = await request('GET', '/api/workflow-templates?category=代码审查');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.length >= 1);
      assert.ok(res.body.data.every(t => t.category === '代码审查'));
    });

    it('should return empty array for non-existent category', async () => {
      const res = await request('GET', '/api/workflow-templates?category=不存在的分类');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.length, 0);
    });

    it('should include custom templates in the list', async () => {
      await request('POST', '/api/workflow-templates', {
        name: 'Custom Template',
        category: '自定义',
        description: 'A custom workflow template'
      });

      const res = await request('GET', '/api/workflow-templates');

      assert.strictEqual(res.status, 200);
      // 22 built-in + 1 custom
      assert.strictEqual(res.body.data.length, 23);
      const custom = res.body.data.find(t => t.name === 'Custom Template');
      assert.ok(custom);
      assert.strictEqual(custom.isBuiltin, false);
    });
  });

  describe('GET /api/workflow-templates/:id', () => {
    it('should get a single template by ID', async () => {
      const res = await request('GET', '/api/workflow-templates/wtpl-code-review');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.id, 'wtpl-code-review');
      assert.strictEqual(res.body.data.name, '代码审查流水线');
      assert.ok(Array.isArray(res.body.data.nodes));
      assert.ok(Array.isArray(res.body.data.edges));
      assert.strictEqual(res.body.data.nodes.length, 4);
      assert.strictEqual(res.body.data.edges.length, 4);
    });

    it('should return 404 for non-existent template', async () => {
      const res = await request('GET', '/api/workflow-templates/nonexistent');

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'NOT_FOUND');
    });
  });

  describe('POST /api/workflow-templates/:id/clone', () => {
    it('should clone a template into a new workflow', async () => {
      const res = await request('POST', '/api/workflow-templates/wtpl-code-review/clone');

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.id);
      assert.strictEqual(res.body.data.status, 'draft');
      assert.ok(res.body.data.name.includes('代码审查流水线'));
      assert.ok(res.body.data.name.includes('副本'));

      // Nodes should have new IDs but same structure
      assert.strictEqual(res.body.data.nodes.length, 4);
      assert.strictEqual(res.body.data.edges.length, 4);

      // All node IDs should be different from the template
      const templateNodeIds = new Set(['start', 'security', 'quality', 'end']);
      const clonedNodeIds = res.body.data.nodes.map(n => n.id);
      assert.ok(clonedNodeIds.every(id => !templateNodeIds.has(id)));

      // Edge source/target should reference the new node IDs
      const clonedNodeIdSet = new Set(clonedNodeIds);
      for (const edge of res.body.data.edges) {
        assert.ok(clonedNodeIdSet.has(edge.source), `Edge source ${edge.source} should be a cloned node ID`);
        assert.ok(clonedNodeIdSet.has(edge.target), `Edge target ${edge.target} should be a cloned node ID`);
      }
    });

    it('should return 404 for non-existent template', async () => {
      const res = await request('POST', '/api/workflow-templates/nonexistent/clone');

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'NOT_FOUND');
    });

    it('should clone a custom template', async () => {
      // First create a custom template
      const createRes = await request('POST', '/api/workflow-templates', {
        name: 'My Custom Template',
        category: '自定义',
        description: 'A custom template',
        nodes: [
          { id: 's', type: 'start', position: { x: 0, y: 0 }, label: 'Start' },
          { id: 'a', type: 'agent', position: { x: 200, y: 0 }, label: 'Agent A', config: {} },
          { id: 'e', type: 'end', position: { x: 400, y: 0 }, label: 'End' }
        ],
        edges: [
          { id: 'e1', source: 's', target: 'a' },
          { id: 'e2', source: 'a', target: 'e' }
        ]
      });
      const templateId = createRes.body.data.id;

      // Now clone it
      const res = await request('POST', `/api/workflow-templates/${templateId}/clone`);

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.nodes.length, 3);
      assert.strictEqual(res.body.data.edges.length, 2);
    });
  });

  describe('POST /api/workflow-templates', () => {
    it('should create a custom template', async () => {
      const res = await request('POST', '/api/workflow-templates', {
        name: 'My Template',
        category: '测试',
        description: 'A test template',
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, label: 'Start' },
          { id: 'end', type: 'end', position: { x: 200, y: 0 }, label: 'End' }
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'end' }
        ]
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.id);
      assert.strictEqual(res.body.data.name, 'My Template');
      assert.strictEqual(res.body.data.isBuiltin, false);
      assert.strictEqual(res.body.data.nodes.length, 2);
      assert.strictEqual(res.body.data.edges.length, 1);
    });

    it('should reject template without name', async () => {
      const res = await request('POST', '/api/workflow-templates', {
        description: 'Missing name'
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
    });

    it('should create template with defaults when optional fields are missing', async () => {
      const res = await request('POST', '/api/workflow-templates', {
        name: 'Minimal Template'
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.name, 'Minimal Template');
      assert.strictEqual(res.body.data.category, '自定义');
      assert.strictEqual(res.body.data.description, '');
      assert.deepStrictEqual(res.body.data.nodes, []);
      assert.deepStrictEqual(res.body.data.edges, []);
    });
  });
});
