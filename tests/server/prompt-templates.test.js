const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createApp } = require('../../src/server/app');
const { getApiKey } = require('../../src/server/middleware/auth');
const PromptTemplateModel = require('../../src/server/models/PromptTemplate');

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

describe('Prompt Templates API', () => {
  before(async () => {
    PromptTemplateModel.clear();
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  beforeEach(() => {
    PromptTemplateModel.clear();
  });

  describe('POST /api/prompt-templates', () => {
    it('should create a prompt template', async () => {
      const res = await request('POST', '/api/prompt-templates', {
        name: 'Code Review',
        content: 'Review the following code: {{code}}',
        description: 'Template for code reviews',
        category: 'development',
        variables: [{ name: 'code', defaultValue: '' }]
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.name, 'Code Review');
      assert.strictEqual(res.body.data.content, 'Review the following code: {{code}}');
      assert.strictEqual(res.body.data.category, 'development');
      assert.strictEqual(res.body.data.variables.length, 1);
      assert.strictEqual(res.body.data.usageCount, 0);
      assert.ok(res.body.data.id);
      assert.ok(res.body.data.createdAt);
    });

    it('should reject template without name', async () => {
      const res = await request('POST', '/api/prompt-templates', {
        content: 'Some content'
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    it('should reject template without content', async () => {
      const res = await request('POST', '/api/prompt-templates', {
        name: 'Test'
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe('GET /api/prompt-templates', () => {
    it('should list all templates', async () => {
      PromptTemplateModel.create({ name: 'T1', content: 'content1' });
      PromptTemplateModel.create({ name: 'T2', content: 'content2' });

      const res = await request('GET', '/api/prompt-templates');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.items.length, 2);
      assert.strictEqual(res.body.data.total, 2);
    });

    it('should filter by category', async () => {
      PromptTemplateModel.create({ name: 'T1', content: 'c1', category: 'dev' });
      PromptTemplateModel.create({ name: 'T2', content: 'c2', category: 'writing' });

      const res = await request('GET', '/api/prompt-templates?category=dev');

      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].category, 'dev');
    });

    it('should search by name', async () => {
      PromptTemplateModel.create({ name: 'Code Review', content: 'c1' });
      PromptTemplateModel.create({ name: 'Email Draft', content: 'c2' });

      const res = await request('GET', '/api/prompt-templates?search=code');

      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].name, 'Code Review');
    });
  });

  describe('GET /api/prompt-templates/:id', () => {
    it('should get template by id', async () => {
      const created = PromptTemplateModel.create({ name: 'Test', content: 'test content' });

      const res = await request('GET', `/api/prompt-templates/${created.id}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.name, 'Test');
    });

    it('should return 404 for non-existent template', async () => {
      const res = await request('GET', '/api/prompt-templates/nonexistent-id');

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe('PUT /api/prompt-templates/:id', () => {
    it('should update a template', async () => {
      const created = PromptTemplateModel.create({ name: 'Old', content: 'old content' });

      const res = await request('PUT', `/api/prompt-templates/${created.id}`, {
        name: 'Updated',
        content: 'new content'
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.name, 'Updated');
      assert.strictEqual(res.body.data.content, 'new content');
    });

    it('should return 404 for updating non-existent template', async () => {
      const res = await request('PUT', '/api/prompt-templates/nonexistent', { name: 'X' });

      assert.strictEqual(res.status, 404);
    });
  });

  describe('DELETE /api/prompt-templates/:id', () => {
    it('should delete a template', async () => {
      const created = PromptTemplateModel.create({ name: 'Delete Me', content: 'content' });

      const res = await request('DELETE', `/api/prompt-templates/${created.id}`);

      assert.strictEqual(res.status, 204);
      assert.strictEqual(PromptTemplateModel.count(), 0);
    });

    it('should return 404 for non-existent template', async () => {
      const res = await request('DELETE', '/api/prompt-templates/nonexistent');

      assert.strictEqual(res.status, 404);
    });
  });

  describe('POST /api/prompt-templates/:id/use', () => {
    it('should increment usage count', async () => {
      const created = PromptTemplateModel.create({ name: 'Used', content: 'content' });

      const res = await request('POST', `/api/prompt-templates/${created.id}/use`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.usageCount, 1);

      // Use again
      const res2 = await request('POST', `/api/prompt-templates/${created.id}/use`);
      assert.strictEqual(res2.body.data.usageCount, 2);
    });

    it('should return 404 for non-existent template', async () => {
      const res = await request('POST', '/api/prompt-templates/nonexistent/use');

      assert.strictEqual(res.status, 404);
    });
  });

  describe('Preset Template Protection', () => {
    it('should create a preset template', async () => {
      const created = PromptTemplateModel.create({
        name: 'Preset Template',
        content: 'Preset content',
        category: 'preset',
        preset: true
      });

      assert.strictEqual(created.preset, true);
      assert.strictEqual(created.category, 'preset');
    });

    it('should reject updating a preset template', async () => {
      const preset = PromptTemplateModel.create({
        name: 'Protected',
        content: 'Protected content',
        preset: true
      });

      const res = await request('PUT', `/api/prompt-templates/${preset.id}`, {
        name: 'Hacked'
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);

      // Verify original is unchanged
      const original = PromptTemplateModel.findById(preset.id);
      assert.strictEqual(original.name, 'Protected');
    });

    it('should reject deleting a preset template', async () => {
      const preset = PromptTemplateModel.create({
        name: 'Protected Delete',
        content: 'Protected content',
        preset: true
      });

      const res = await request('DELETE', `/api/prompt-templates/${preset.id}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);

      // Verify still exists
      assert.ok(PromptTemplateModel.exists(preset.id));
    });

    it('should allow updating a non-preset template', async () => {
      const custom = PromptTemplateModel.create({
        name: 'Custom',
        content: 'Custom content',
        preset: false
      });

      const res = await request('PUT', `/api/prompt-templates/${custom.id}`, {
        name: 'Updated Custom'
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.name, 'Updated Custom');
    });

    it('should allow deleting a non-preset template', async () => {
      const custom = PromptTemplateModel.create({
        name: 'Custom Delete',
        content: 'Custom content',
        preset: false
      });

      const res = await request('DELETE', `/api/prompt-templates/${custom.id}`);

      assert.strictEqual(res.status, 204);
      assert.strictEqual(PromptTemplateModel.exists(custom.id), false);
    });

    it('should find template by name', async () => {
      PromptTemplateModel.create({ name: 'Findable', content: 'content' });

      const found = PromptTemplateModel.findByName('Findable');
      assert.ok(found);
      assert.strictEqual(found.name, 'Findable');

      const notFound = PromptTemplateModel.findByName('Nonexistent');
      assert.strictEqual(notFound, null);
    });
  });
});
