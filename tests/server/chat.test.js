const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../dist/server/app');
const { getApiKey } = require('../../dist/server/middleware/auth');
const ChatSessionModel = require('../../dist/server/models/ChatSession');

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

describe('Chat API', () => {
  before(async () => {
    ChatSessionModel.clear();
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  beforeEach(() => {
    ChatSessionModel.clear();
  });

  describe('POST /api/chat', () => {
    it('should create a chat session', async () => {
      const res = await request('POST', '/api/chat', {
        title: 'Test Chat',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'You are a helpful assistant'
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.title, 'Test Chat');
      assert.strictEqual(res.body.data.status, 'active');
      assert.ok(res.body.data.id);
      assert.ok(Array.isArray(res.body.data.messages));
      assert.strictEqual(res.body.data.messages.length, 0);
    });

    it('should create session with defaults', async () => {
      const res = await request('POST', '/api/chat', {});

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.title, 'New Chat');
      assert.strictEqual(res.body.data.status, 'active');
    });
  });

  describe('GET /api/chat', () => {
    it('should list chat sessions', async () => {
      ChatSessionModel.create({ title: 'Chat 1' });
      ChatSessionModel.create({ title: 'Chat 2' });

      const res = await request('GET', '/api/chat');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 2);
      assert.strictEqual(res.body.data.total, 2);
    });

    it('should filter by status', async () => {
      ChatSessionModel.create({ title: 'Active' });
      const archived = ChatSessionModel.create({ title: 'Archived' });
      ChatSessionModel.update(archived.id, { status: 'archived' });

      const res = await request('GET', '/api/chat?status=active');

      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].status, 'active');
    });
  });

  describe('GET /api/chat/:id', () => {
    it('should get session by id', async () => {
      const created = ChatSessionModel.create({ title: 'My Chat' });

      const res = await request('GET', `/api/chat/${created.id}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.title, 'My Chat');
    });

    it('should return 404 for non-existent session', async () => {
      const res = await request('GET', '/api/chat/nonexistent');

      assert.strictEqual(res.status, 404);
    });
  });

  describe('DELETE /api/chat/:id', () => {
    it('should delete a session', async () => {
      const created = ChatSessionModel.create({ title: 'Delete Me' });

      const res = await request('DELETE', `/api/chat/${created.id}`);

      assert.strictEqual(res.status, 204);
      assert.strictEqual(ChatSessionModel.count(), 0);
    });

    it('should return 404 for non-existent session', async () => {
      const res = await request('DELETE', '/api/chat/nonexistent');

      assert.strictEqual(res.status, 404);
    });
  });

  describe('POST /api/chat/:id/archive', () => {
    it('should archive a session', async () => {
      const created = ChatSessionModel.create({ title: 'Archive Me' });

      const res = await request('POST', `/api/chat/${created.id}/archive`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.status, 'archived');
    });

    it('should return 404 for non-existent session', async () => {
      const res = await request('POST', '/api/chat/nonexistent/archive');

      assert.strictEqual(res.status, 404);
    });
  });

  describe('POST /api/chat/slash-commands', () => {
    it('should list available slash commands', async () => {
      const res = await request('POST', '/api/chat/slash-commands');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length > 0);
      assert.ok(res.body.data.some(c => c.command === '/help'));
    });
  });

  describe('POST /api/chat/:id/execute', () => {
    it('should return 404 for non-existent session', async () => {
      const res = await request('POST', '/api/chat/nonexistent/execute', {
        type: 'write',
        path: 'test.txt',
        content: 'hello'
      });

      assert.strictEqual(res.status, 404);
    });
  });
});
