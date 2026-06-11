const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const { createApp } = require('../../dist/server/app');
const { getApiKey } = require('../../dist/server/middleware/auth');
const config = require('../../dist/server/config');
const FileService = require('../../dist/server/services/FileService');

let server;
let baseUrl;

/**
 * Windows-safe recursive delete with retry.
 * Windows holds file handles that cause EPERM; retry with backoff.
 */
function safeRmSync(target, retries = 3, delayMs = 200) {
  for (let i = 0; i < retries; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (err) {
      if (err.code === 'EPERM' && i < retries - 1) {
        // Wait for Windows to release file handles
        const start = Date.now();
        while (Date.now() - start < delayMs) { /* busy wait */ }
        delayMs *= 2;
      } else if (err.code !== 'ENOENT') {
        // Silently ignore ENOENT (already deleted); rethrow others
        throw err;
      }
    }
  }
}

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

describe('File API', () => {
  before(async () => {
    // Set up test workspace
    const workspaceRoot = process.env.WORKSPACE_ROOT || path.join(__dirname, '../.temp-data/test-workspace');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    FileService.setWorkspaceRoot(workspaceRoot);
    FileService.ensureWorkspace();
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise(resolve => server.close(resolve)));

  beforeEach(() => {
    // Clean up workspace
    const root = config.workspaceRoot;
    if (fs.existsSync(root)) {
      const entries = fs.readdirSync(root);
      for (const entry of entries) {
        const fullPath = path.join(root, entry);
        safeRmSync(fullPath);
      }
    }
  });

  describe('POST /api/files/workspace', () => {
    it('should create a workspace', async () => {
      const res = await request('POST', '/api/files/workspace', {
        name: 'test-project',
        template: 'basic'
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.name, 'test-project');
    });

    it('should reject workspace without name', async () => {
      const res = await request('POST', '/api/files/workspace', {});

      assert.strictEqual(res.status, 400);
    });
  });

  describe('GET /api/files', () => {
    it('should list directory contents', async () => {
      // Create a test file
      const root = config.workspaceRoot;
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, 'test.txt'), 'hello');

      const res = await request('GET', '/api/files');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length > 0);
    });

    it('should list subdirectory', async () => {
      const root = config.workspaceRoot;
      fs.mkdirSync(path.join(root, 'subdir'), { recursive: true });
      fs.writeFileSync(path.join(root, 'subdir', 'file.js'), 'code');

      const res = await request('GET', '/api/files?path=subdir');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.length, 1);
      assert.strictEqual(res.body.data[0].name, 'file.js');
    });
  });

  describe('POST /api/files/write', () => {
    it('should write a file', async () => {
      const res = await request('POST', '/api/files/write', {
        path: 'test.txt',
        content: 'Hello World'
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.path, 'test.txt');
      assert.ok(res.body.data.size > 0);
    });

    it('should create parent directories', async () => {
      const res = await request('POST', '/api/files/write', {
        path: 'deep/nested/file.txt',
        content: 'content'
      });

      assert.strictEqual(res.status, 200);

      // Verify file exists
      const fullPath = path.join(config.workspaceRoot, 'deep', 'nested', 'file.txt');
      assert.ok(fs.existsSync(fullPath));
    });
  });

  describe('GET /api/files/read', () => {
    it('should read a file', async () => {
      // Create file first
      await request('POST', '/api/files/write', {
        path: 'readable.txt',
        content: 'Hello Content'
      });

      const res = await request('GET', '/api/files/read?path=readable.txt');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.content, 'Hello Content');
      assert.strictEqual(res.body.data.encoding, 'utf-8');
    });

    it('should return 404 for non-existent file', async () => {
      const res = await request('GET', '/api/files/read?path=nonexistent.txt');

      assert.strictEqual(res.status, 404);
    });

    it('should require path parameter', async () => {
      const res = await request('GET', '/api/files/read');

      assert.strictEqual(res.status, 400);
    });
  });

  describe('POST /api/files/mkdir', () => {
    it('should create a directory', async () => {
      const res = await request('POST', '/api/files/mkdir', { path: 'newdir' });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.path, 'newdir');

      const fullPath = path.join(config.workspaceRoot, 'newdir');
      assert.ok(fs.existsSync(fullPath));
      assert.ok(fs.statSync(fullPath).isDirectory());
    });

    it('should reject existing directory', async () => {
      await request('POST', '/api/files/mkdir', { path: 'existing' });
      const res = await request('POST', '/api/files/mkdir', { path: 'existing' });

      assert.strictEqual(res.status, 409);
    });
  });

  describe('DELETE /api/files', () => {
    it('should delete a file', async () => {
      await request('POST', '/api/files/write', { path: 'deleteme.txt', content: 'bye' });

      const res = await request('DELETE', '/api/files', { path: 'deleteme.txt' });

      assert.strictEqual(res.status, 200);

      const fullPath = path.join(config.workspaceRoot, 'deleteme.txt');
      assert.ok(!fs.existsSync(fullPath));
    });

    it('should delete a directory recursively', async () => {
      const root = config.workspaceRoot;
      fs.mkdirSync(path.join(root, 'deldir'), { recursive: true });
      fs.writeFileSync(path.join(root, 'deldir', 'file.txt'), 'content');

      const res = await request('DELETE', '/api/files', { path: 'deldir' });

      assert.strictEqual(res.status, 200);
    });

    it('should return 404 for non-existent path', async () => {
      const res = await request('DELETE', '/api/files', { path: 'nonexistent' });

      assert.strictEqual(res.status, 404);
    });
  });

  describe('POST /api/files/rename', () => {
    it('should rename a file', async () => {
      await request('POST', '/api/files/write', { path: 'old.txt', content: 'data' });

      const res = await request('POST', '/api/files/rename', {
        oldPath: 'old.txt',
        newPath: 'new.txt'
      });

      assert.strictEqual(res.status, 200);

      const oldFull = path.join(config.workspaceRoot, 'old.txt');
      const newFull = path.join(config.workspaceRoot, 'new.txt');
      assert.ok(!fs.existsSync(oldFull));
      assert.ok(fs.existsSync(newFull));
    });

    it('should return 404 for non-existent source', async () => {
      const res = await request('POST', '/api/files/rename', {
        oldPath: 'nonexistent',
        newPath: 'new'
      });

      assert.strictEqual(res.status, 404);
    });
  });

  describe('GET /api/files/browse', () => {
    it('should list only directories', async () => {
      const root = config.workspaceRoot;
      fs.mkdirSync(path.join(root, 'dir1'), { recursive: true });
      fs.mkdirSync(path.join(root, 'dir2'), { recursive: true });
      fs.writeFileSync(path.join(root, 'file.txt'), 'content');

      const res = await request('GET', '/api/files/browse');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.directories.length, 2);
      assert.ok(res.body.data.directories.every(d => d.name.startsWith('dir')));
      assert.strictEqual(res.body.data.currentPath, '');
      assert.strictEqual(res.body.data.parentPath, null);
    });

    it('should return empty directories for empty folder', async () => {
      const root = config.workspaceRoot;
      fs.mkdirSync(path.join(root, 'empty'), { recursive: true });

      const res = await request('GET', '/api/files/browse?path=empty');

      assert.strictEqual(res.body.data.directories.length, 0);
    });

    it('should include parentPath for nested directories', async () => {
      const root = config.workspaceRoot;
      fs.mkdirSync(path.join(root, 'parent', 'child'), { recursive: true });

      const res = await request('GET', '/api/files/browse?path=parent/child');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.currentPath, 'parent/child');
      assert.strictEqual(res.body.data.parentPath, 'parent');
    });

    it('should return 404 for non-existent path', async () => {
      const res = await request('GET', '/api/files/browse?path=nonexistent');

      assert.strictEqual(res.status, 404);
    });

    it('should reject path traversal', async () => {
      const res = await request('GET', '/api/files/browse?path=../escape');

      assert.ok(res.status === 400 || res.status === 403);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe('POST /api/files/workspace with parentPath', () => {
    it('should create workspace in parent directory', async () => {
      const root = config.workspaceRoot;
      fs.mkdirSync(path.join(root, 'projects'), { recursive: true });

      const res = await request('POST', '/api/files/workspace', {
        name: 'my-app',
        parentPath: 'projects'
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.name, 'my-app');

      // Verify directory was created in the right place
      const createdPath = path.join(root, 'projects', 'my-app');
      assert.ok(fs.existsSync(createdPath));
      assert.ok(fs.statSync(createdPath).isDirectory());
    });

    it('should create workspace at root when parentPath is empty', async () => {
      const res = await request('POST', '/api/files/workspace', {
        name: 'root-ws'
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.name, 'root-ws');
    });

    it('should reject path traversal in parentPath', async () => {
      const res = await request('POST', '/api/files/workspace', {
        name: 'evil',
        parentPath: '../../escape'
      });

      assert.ok(res.status === 400 || res.status === 403);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe('Path Traversal Prevention', () => {
    it('should reject paths with ".."', async () => {
      const res = await request('GET', '/api/files/read?path=../etc/passwd');

      assert.ok(res.status === 400 || res.status === 403, `Expected 400 or 403, got ${res.status}`);
      assert.strictEqual(res.body.success, false);
    });

    it('should reject absolute paths outside workspace', async () => {
      const res = await request('GET', '/api/files/read?path=/etc/passwd');

      // Absolute paths outside the active workspace are now blocked for security.
      assert.ok(res.status === 403 || res.status === 404, `Expected 403 or 404, got ${res.status}`);
    });

    it('should reject ".." in write path', async () => {
      const res = await request('POST', '/api/files/write', {
        path: '../escape.txt',
        content: 'hack'
      });

      assert.ok(res.status === 400 || res.status === 403, `Expected 400 or 403, got ${res.status}`);
      assert.strictEqual(res.body.success, false);
    });

    it('should reject ".." in mkdir', async () => {
      const res = await request('POST', '/api/files/mkdir', { path: '../escape' });

      assert.ok(res.status === 400 || res.status === 403, `Expected 400 or 403, got ${res.status}`);
      assert.strictEqual(res.body.success, false);
    });
  });

  describe('POST /api/files/set-workspace + GET /api/files/workspace-info', () => {
    it('should change workspace and reflect in workspace-info', async () => {
      // Create a temp directory under workspace root
      const root = config.workspaceRoot;
      const tempDir = path.join(root, 'newws');
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'file.txt'), 'content');

      // Switch workspace
      const switchRes = await request('POST', '/api/files/set-workspace', { path: tempDir });
      assert.strictEqual(switchRes.status, 200);
      assert.strictEqual(switchRes.body.success, true);

      // Verify workspace-info shows new path
      const infoRes = await request('GET', '/api/files/workspace-info');
      assert.strictEqual(infoRes.status, 200);
      assert.strictEqual(infoRes.body.data.isDefault, false);

      // Verify file listing shows new workspace content
      // Note: WORKFLOWS folder is auto-created by setWorkspaceRoot
      const listRes = await request('GET', '/api/files');
      assert.strictEqual(listRes.status, 200);
      const names = listRes.body.data.map(d => d.name);
      assert.ok(names.includes('file.txt'), 'should include file.txt');
      assert.ok(names.includes('WORKFLOWS'), 'should include WORKFLOWS folder');

      // Reset workspace back to default
      await request('POST', '/api/files/set-workspace', { path: root });
    });

    it('should reject non-existent path for set-workspace', async () => {
      const res = await request('POST', '/api/files/set-workspace', { path: 'D:\\nonexistent_dir_xyz' });
      assert.strictEqual(res.status, 404);
    });

    it('should require path for set-workspace', async () => {
      const res = await request('POST', '/api/files/set-workspace', {});
      assert.strictEqual(res.status, 400);
    });
  });
});
