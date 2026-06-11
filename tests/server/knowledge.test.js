const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../dist/server/app');
const { getApiKey } = require('../../dist/server/middleware/auth');
const KnowledgeService = require('../../dist/server/services/KnowledgeService');

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

describe('Knowledge API', () => {
  before(async () => {
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  beforeEach(() => {
    KnowledgeService._index = [];
  });

  describe('POST /api/knowledge', () => {
    it('should create a knowledge entry', async () => {
      const res = await request('POST', '/api/knowledge', {
        title: 'Test Entry',
        content: 'Some content',
        category: 'test',
        tags: ['tag1', 'tag2']
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.id);
      assert.strictEqual(res.body.data.title, 'Test Entry');
      assert.strictEqual(res.body.data.content, 'Some content');
      assert.strictEqual(res.body.data.category, 'test');
      assert.deepStrictEqual(res.body.data.tags, ['tag1', 'tag2']);
      assert.strictEqual(res.body.data.source, 'manual');
    });

    it('should reject entry without title', async () => {
      const res = await request('POST', '/api/knowledge', { content: 'no title' });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    it('should default category to general', async () => {
      const res = await request('POST', '/api/knowledge', { title: 'No Category' });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.category, 'general');
    });
  });

  describe('GET /api/knowledge', () => {
    it('should list all knowledge entries', async () => {
      await request('POST', '/api/knowledge', { title: 'Entry 1', content: 'Content 1' });
      await request('POST', '/api/knowledge', { title: 'Entry 2', content: 'Content 2' });

      const res = await request('GET', '/api/knowledge');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.items.length, 2);
      assert.strictEqual(res.body.data.total, 2);
    });

    it('should search by query', async () => {
      await request('POST', '/api/knowledge', { title: 'JavaScript Guide', content: 'Learn JS' });
      await request('POST', '/api/knowledge', { title: 'Python Guide', content: 'Learn Python' });

      const res = await request('GET', '/api/knowledge?q=javascript');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].title, 'JavaScript Guide');
    });

    it('should filter by category', async () => {
      await request('POST', '/api/knowledge', { title: 'A', content: 'C', category: 'tech' });
      await request('POST', '/api/knowledge', { title: 'B', content: 'D', category: 'science' });

      const res = await request('GET', '/api/knowledge?category=tech');

      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].category, 'tech');
    });

    it('should filter by tag', async () => {
      await request('POST', '/api/knowledge', { title: 'A', content: 'C', tags: ['js'] });
      await request('POST', '/api/knowledge', { title: 'B', content: 'D', tags: ['py'] });

      const res = await request('GET', '/api/knowledge?tag=js');

      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].tags[0], 'js');
    });
  });

  describe('PUT /api/knowledge/:id', () => {
    it('should update a knowledge entry', async () => {
      const createRes = await request('POST', '/api/knowledge', { title: 'Original', content: 'Content' });
      const id = createRes.body.data.id;

      const res = await request('PUT', `/api/knowledge/${id}`, { title: 'Updated' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.title, 'Updated');
    });

    it('should return 404 for non-existent entry', async () => {
      const res = await request('PUT', '/api/knowledge/nonexistent', { title: 'X' });

      assert.strictEqual(res.status, 404);
    });
  });

  describe('DELETE /api/knowledge/:id', () => {
    it('should delete a knowledge entry', async () => {
      const createRes = await request('POST', '/api/knowledge', { title: 'To Delete', content: 'Content' });
      const id = createRes.body.data.id;

      const res = await request('DELETE', `/api/knowledge/${id}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

    it('should return 404 for non-existent entry', async () => {
      const res = await request('DELETE', '/api/knowledge/nonexistent');

      assert.strictEqual(res.status, 404);
    });
  });
});

describe('Tag API', () => {
  before(async () => {
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  beforeEach(() => {
    const TagService = require('../../dist/server/services/TagService');
    TagService._tags = [];
  });

  describe('POST /api/knowledge/tags', () => {
    it('should create a tag', async () => {
      const res = await request('POST', '/api/knowledge/tags', { name: 'javascript', color: '#f0db4f' });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.name, 'javascript');
      assert.strictEqual(res.body.data.color, '#f0db4f');
      assert.ok(res.body.data.id);
    });

    it('should reject duplicate tag name', async () => {
      await request('POST', '/api/knowledge/tags', { name: 'dup' });
      const res = await request('POST', '/api/knowledge/tags', { name: 'dup' });

      assert.strictEqual(res.status, 409);
    });

    it('should reject tag without name', async () => {
      const res = await request('POST', '/api/knowledge/tags', {});

      assert.strictEqual(res.status, 400);
    });
  });

  describe('GET /api/knowledge/tags', () => {
    it('should list tags', async () => {
      await request('POST', '/api/knowledge/tags', { name: 'tag1' });
      await request('POST', '/api/knowledge/tags', { name: 'tag2' });

      const res = await request('GET', '/api/knowledge/tags');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.length, 2);
    });
  });

  describe('DELETE /api/knowledge/tags/:id', () => {
    it('should delete a tag', async () => {
      const createRes = await request('POST', '/api/knowledge/tags', { name: 'toDelete' });
      const id = createRes.body.data.id;

      const res = await request('DELETE', `/api/knowledge/tags/${id}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

    it('should return 404 for non-existent tag', async () => {
      const res = await request('DELETE', '/api/knowledge/tags/nonexistent');

      assert.strictEqual(res.status, 404);
    });
  });
});
