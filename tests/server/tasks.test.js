const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../src/server/app');
const { getApiKey } = require('../../src/server/middleware/auth');
const TaskModel = require('../../src/server/models/Task');
const AgentModel = require('../../src/server/models/Agent');

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

describe('Task API', () => {
  before(async () => {
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  beforeEach(() => {
    TaskModel.clear();
    AgentModel.clear();
  });

  describe('POST /api/tasks', () => {
    it('should create a task', async () => {
      const res = await request('POST', '/api/tasks', {
        title: 'Test Task',
        description: 'A test task',
        priority: 'high'
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.id);
      assert.strictEqual(res.body.data.title, 'Test Task');
      assert.strictEqual(res.body.data.status, 'pending');
      assert.strictEqual(res.body.data.priority, 'high');
    });

    it('should use default priority', async () => {
      const res = await request('POST', '/api/tasks', { title: 'Test Task' });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.priority, 'medium');
    });

    it('should reject task without title', async () => {
      const res = await request('POST', '/api/tasks', {});

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    it('should reject invalid priority', async () => {
      const res = await request('POST', '/api/tasks', {
        title: 'Test',
        priority: 'invalid'
      });

      assert.strictEqual(res.status, 400);
    });

    it('should reject non-existent assignedAgentId', async () => {
      const res = await request('POST', '/api/tasks', {
        title: 'Test',
        assignedAgentId: 'nonexistent'
      });

      assert.strictEqual(res.status, 400);
    });

    it('should accept valid assignedAgentId', async () => {
      const agentRes = await request('POST', '/api/agents', { name: 'Agent', role: 'developer' });
      const agentId = agentRes.body.data.id;

      const res = await request('POST', '/api/tasks', {
        title: 'Test',
        assignedAgentId: agentId
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.assignedAgentId, agentId);
    });
  });

  describe('GET /api/tasks', () => {
    it('should list tasks', async () => {
      await request('POST', '/api/tasks', { title: 'Task 1' });
      await request('POST', '/api/tasks', { title: 'Task 2' });

      const res = await request('GET', '/api/tasks');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 2);
      assert.strictEqual(res.body.data.total, 2);
    });

    it('should filter by status', async () => {
      const createRes = await request('POST', '/api/tasks', { title: 'Task 1' });
      const taskId = createRes.body.data.id;
      await request('POST', '/api/tasks', { title: 'Task 2' });

      // Update status directly via model for test
      TaskModel.update(taskId, { status: 'running' });

      const res = await request('GET', '/api/tasks?status=running');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 1);
    });

    it('should filter by priority', async () => {
      await request('POST', '/api/tasks', { title: 'Task 1', priority: 'high' });
      await request('POST', '/api/tasks', { title: 'Task 2', priority: 'low' });

      const res = await request('GET', '/api/tasks?priority=high');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].priority, 'high');
    });

    it('should support pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await request('POST', '/api/tasks', { title: `Task ${i}` });
      }

      const res = await request('GET', '/api/tasks?page=1&limit=2');

      assert.strictEqual(res.body.data.items.length, 2);
      assert.strictEqual(res.body.data.total, 5);
    });
  });

  describe('GET /api/tasks/:id', () => {
    it('should get task by id', async () => {
      const createRes = await request('POST', '/api/tasks', { title: 'Test Task' });
      const taskId = createRes.body.data.id;

      const res = await request('GET', `/api/tasks/${taskId}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.title, 'Test Task');
    });

    it('should return 404 for non-existent task', async () => {
      const res = await request('GET', '/api/tasks/nonexistent');

      assert.strictEqual(res.status, 404);
    });
  });

  describe('PUT /api/tasks/:id', () => {
    it('should update task fields', async () => {
      const createRes = await request('POST', '/api/tasks', { title: 'Test Task' });
      const taskId = createRes.body.data.id;

      const res = await request('PUT', `/api/tasks/${taskId}`, {
        title: 'Updated Task',
        priority: 'urgent'
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.title, 'Updated Task');
      assert.strictEqual(res.body.data.priority, 'urgent');
    });
  });

  describe('DELETE /api/tasks/:id', () => {
    it('should delete pending task', async () => {
      const createRes = await request('POST', '/api/tasks', { title: 'Test Task' });
      const taskId = createRes.body.data.id;

      const res = await request('DELETE', `/api/tasks/${taskId}`);

      assert.strictEqual(res.status, 204);
    });

    it('should not delete running task', async () => {
      const createRes = await request('POST', '/api/tasks', { title: 'Test Task' });
      const taskId = createRes.body.data.id;

      // 直接通过模型设置为 running（避免后台执行自动完成）
      TaskModel.update(taskId, { status: 'running' });

      const res = await request('DELETE', `/api/tasks/${taskId}`);

      assert.strictEqual(res.status, 409);
    });
  });

  describe('POST /api/tasks/:id/execute', () => {
    it('should execute pending task', async () => {
      const createRes = await request('POST', '/api/tasks', { title: 'Test Task' });
      const taskId = createRes.body.data.id;

      const res = await request('POST', `/api/tasks/${taskId}/execute`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'running');
    });

    it('should not execute completed task', async () => {
      const createRes = await request('POST', '/api/tasks', { title: 'Test Task' });
      const taskId = createRes.body.data.id;

      // Set to completed via model
      TaskModel.update(taskId, { status: 'running' });
      TaskModel.update(taskId, { status: 'completed' });

      const res = await request('POST', `/api/tasks/${taskId}/execute`);

      assert.strictEqual(res.status, 400);
    });
  });

  describe('POST /api/tasks/:id/cancel', () => {
    it('should cancel pending task', async () => {
      const createRes = await request('POST', '/api/tasks', { title: 'Test Task' });
      const taskId = createRes.body.data.id;

      const res = await request('POST', `/api/tasks/${taskId}/cancel`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'cancelled');
    });

    it('should cancel running task', async () => {
      const createRes = await request('POST', '/api/tasks', { title: 'Test Task' });
      const taskId = createRes.body.data.id;

      // 直接通过模型设置为 running（避免后台执行自动完成）
      TaskModel.update(taskId, { status: 'running' });

      const res = await request('POST', `/api/tasks/${taskId}/cancel`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'cancelled');
    });

    it('should not cancel completed task', async () => {
      const createRes = await request('POST', '/api/tasks', { title: 'Test Task' });
      const taskId = createRes.body.data.id;

      TaskModel.update(taskId, { status: 'running' });
      TaskModel.update(taskId, { status: 'completed' });

      const res = await request('POST', `/api/tasks/${taskId}/cancel`);

      assert.strictEqual(res.status, 400);
    });
  });

  describe('Task Status Transitions', () => {
    it('should validate valid transitions', () => {
      assert.strictEqual(TaskModel.isValidTransition('pending', 'running'), true);
      assert.strictEqual(TaskModel.isValidTransition('pending', 'cancelled'), true);
      assert.strictEqual(TaskModel.isValidTransition('running', 'completed'), true);
      assert.strictEqual(TaskModel.isValidTransition('running', 'failed'), true);
      assert.strictEqual(TaskModel.isValidTransition('running', 'cancelled'), true);
      assert.strictEqual(TaskModel.isValidTransition('failed', 'pending'), true);
      assert.strictEqual(TaskModel.isValidTransition('cancelled', 'pending'), true);
    });

    it('should reject invalid transitions', () => {
      assert.strictEqual(TaskModel.isValidTransition('completed', 'running'), false);
      assert.strictEqual(TaskModel.isValidTransition('cancelled', 'running'), false);
      assert.strictEqual(TaskModel.isValidTransition('pending', 'completed'), false);
    });
  });
});
