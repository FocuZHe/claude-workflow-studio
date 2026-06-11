const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { createApp } = require('../../dist/server/app');
const MemoryService = require('../../dist/server/services/MemoryService');
const SnapshotService = require('../../dist/server/services/SnapshotService');
const KnowledgeService = require('../../dist/server/services/KnowledgeService');
const TagService = require('../../dist/server/services/TagService');

let server;
let baseUrl;
let tmpDir;

function api(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const bodyStr = data ? JSON.stringify(data) : null;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : null;
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

describe('Integration Tests', () => {
  let agentId, workflowId;

  before(async () => {
    // Create temp workspace for services that need file system
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-test-'));
    MemoryService.init(tmpDir);
    SnapshotService.init(tmpDir);
    KnowledgeService.init(tmpDir);
    TagService.init(tmpDir);

    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => {
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore cleanup errors
    }
    return new Promise(resolve => server.close(resolve));
  });

  describe('Agent CRUD Flow', () => {
    it('should create an agent', async () => {
      const res = await api('POST', '/api/agents', {
        name: 'Integration Test Agent',
        role: 'developer',
        config: { model: 'haiku', temperature: 0.3, systemPrompt: 'test' },
        toolPermissions: { readFile: true, writeFile: true },
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);
      agentId = res.data.data.id;
      assert.ok(agentId);
    });

    it('should read the agent', async () => {
      const res = await api('GET', `/api/agents/${agentId}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.name, 'Integration Test Agent');
    });

    it('should update the agent', async () => {
      const res = await api('PUT', `/api/agents/${agentId}`, { name: 'Updated Agent' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.name, 'Updated Agent');
    });

    it('should list agents with pagination', async () => {
      const res = await api('GET', '/api/agents?page=1&limit=10');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.data.items));
      assert.ok(typeof res.data.data.total === 'number');
    });

    it('should delete the agent', async () => {
      const res = await api('DELETE', `/api/agents/${agentId}`);
      assert.strictEqual(res.status, 204);
    });
  });

  describe('Workflow CRUD Flow', () => {
    it('should create a workflow', async () => {
      const res = await api('POST', '/api/workflows', {
        name: 'Integration Test Workflow',
        nodes: [
          { id: 'n1', label: 'Start', type: 'start', position: { x: 60, y: 200 }, config: {} },
          { id: 'n2', label: 'End', type: 'end', position: { x: 300, y: 200 }, config: {} },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      });
      assert.strictEqual(res.status, 201);
      workflowId = res.data.data.id;
      assert.ok(workflowId);
    });

    it('should read the workflow', async () => {
      const res = await api('GET', `/api/workflows/${workflowId}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.name, 'Integration Test Workflow');
    });

    it('should update the workflow', async () => {
      const res = await api('PUT', `/api/workflows/${workflowId}`, { name: 'Updated Workflow' });
      assert.strictEqual(res.status, 200);
    });

    it('should list workflows with pagination', async () => {
      const res = await api('GET', '/api/workflows?page=1&limit=10');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.data.items));
    });

    it('should delete the workflow', async () => {
      const res = await api('DELETE', `/api/workflows/${workflowId}`);
      assert.strictEqual(res.status, 204);
    });
  });

  describe('Knowledge Base Flow', () => {
    let knowledgeId;

    it('should create knowledge entry', async () => {
      const res = await api('POST', '/api/knowledge', {
        title: 'Test Knowledge',
        content: 'This is test content',
        category: 'technical',
        tags: ['test'],
      });
      assert.strictEqual(res.status, 201);
      knowledgeId = res.data.data.id;
      assert.ok(knowledgeId);
    });

    it('should search knowledge', async () => {
      const res = await api('GET', '/api/knowledge?q=Test');
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.data.items.length > 0);
    });

    it('should delete knowledge entry', async () => {
      const res = await api('DELETE', `/api/knowledge/${knowledgeId}`);
      assert.strictEqual(res.status, 200);
    });
  });

  describe('Memory Flow', () => {
    it('should write memory', async () => {
      const res = await api('PUT', '/api/memory/test-workflow', { content: 'test memory' });
      assert.strictEqual(res.status, 200);
    });

    it('should read memory', async () => {
      const res = await api('GET', '/api/memory/test-workflow');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.content, 'test memory');
    });

    it('should search memory', async () => {
      const res = await api('GET', '/api/memory/search?q=test');
      assert.strictEqual(res.status, 200);
    });

    it('should delete memory', async () => {
      const res = await api('DELETE', '/api/memory/test-workflow');
      assert.strictEqual(res.status, 200);
    });
  });

  describe('Snapshot Flow', () => {
    let snapshotId, testWorkflowId;

    before(async () => {
      const res = await api('POST', '/api/workflows', {
        name: 'Snapshot Test',
        nodes: [
          { id: 'n1', label: 'Start', type: 'start', position: { x: 60, y: 200 }, config: {} },
          { id: 'n2', label: 'End', type: 'end', position: { x: 300, y: 200 }, config: {} },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      });
      testWorkflowId = res.data.data.id;
    });

    after(async () => {
      await api('DELETE', `/api/workflows/${testWorkflowId}`);
    });

    it('should create snapshot', async () => {
      const res = await api('POST', `/api/workflows/${testWorkflowId}/snapshots`, { name: 'test snapshot' });
      assert.strictEqual(res.status, 201);
      snapshotId = res.data.data.id;
      assert.ok(snapshotId);
    });

    it('should list snapshots', async () => {
      const res = await api('GET', `/api/workflows/${testWorkflowId}/snapshots`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.data.length > 0);
    });

    it('should restore snapshot', async () => {
      const res = await api('POST', `/api/workflows/${testWorkflowId}/snapshots/${snapshotId}/restore`);
      assert.strictEqual(res.status, 200);
    });

    it('should delete snapshot', async () => {
      const res = await api('DELETE', `/api/workflows/${testWorkflowId}/snapshots/${snapshotId}`);
      assert.strictEqual(res.status, 200);
    });
  });

  describe('Statistics and Timeline', () => {
    it('should get workflow statistics', async () => {
      const res = await api('GET', '/api/workflows/statistics');
      assert.strictEqual(res.status, 200);
      assert.ok(typeof res.data.data.total === 'number');
      assert.ok(typeof res.data.data.successRate === 'number');
    });

    it('should get timeline', async () => {
      const res = await api('GET', '/api/workflows/timeline');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.data.data.items));
    });
  });

  describe('Export and Import', () => {
    let exportWorkflowId;

    before(async () => {
      const res = await api('POST', '/api/workflows', {
        name: 'Export Test',
        nodes: [
          { id: 'n1', label: 'Start', type: 'start', position: { x: 60, y: 200 }, config: {} },
          { id: 'n2', label: 'End', type: 'end', position: { x: 300, y: 200 }, config: {} },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      });
      exportWorkflowId = res.data.data.id;
    });

    after(async () => {
      await api('DELETE', `/api/workflows/${exportWorkflowId}`);
    });

    it('should export workflow', async () => {
      const res = await api('POST', '/api/workflows/export', { ids: [exportWorkflowId] });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.workflows.length, 1);
    });

    it('should import workflow', async () => {
      const exportRes = await api('POST', '/api/workflows/export', { ids: [exportWorkflowId] });
      const res = await api('POST', '/api/workflows/import', { workflows: exportRes.data.data.workflows });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.data.length, 1);
      await api('DELETE', `/api/workflows/${res.data.data[0].id}`);
    });
  });

  describe('Natural Language Workflow Creation', () => {
    let nlWorkflowId;

    it('should create workflow from text', async () => {
      const res = await api('POST', '/api/workflows/create-from-text', { description: '搜集信息，整理文档' });
      assert.strictEqual(res.status, 201);
      assert.ok(res.data.data.nodes.length > 2);
      nlWorkflowId = res.data.data.id;
    });

    after(async () => {
      if (nlWorkflowId) await api('DELETE', `/api/workflows/${nlWorkflowId}`);
    });
  });
});
