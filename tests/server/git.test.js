const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const { createApp } = require('../../dist/server/app');
const { getApiKey } = require('../../dist/server/middleware/auth');
const config = require('../../dist/server/config');
const FileService = require('../../dist/server/services/FileService');

let server;
let baseUrl;
let tempGitDir;

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

function safeRmSync(target, retries = 3, delayMs = 200) {
  for (let i = 0; i < retries; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (err) {
      if (err.code === 'EPERM' && i < retries - 1) {
        const start = Date.now();
        while (Date.now() - start < delayMs) { /* busy wait */ }
        delayMs *= 2;
      } else if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }
}

describe('Git API', () => {
  before(async () => {
    FileService.ensureWorkspace();

    // Create a temp git repo for testing (use os.tmpdir to avoid Chinese path issues with git)
    tempGitDir = path.join(os.tmpdir(), 'claude-test-git-' + Date.now());
    fs.mkdirSync(tempGitDir, { recursive: true });
    execSync('git init', { cwd: tempGitDir, windowsHide: true });
    execSync('git config user.email "test@test.com"', { cwd: tempGitDir, windowsHide: true });
    execSync('git config user.name "Test"', { cwd: tempGitDir, windowsHide: true });

    // Create an initial commit
    fs.writeFileSync(path.join(tempGitDir, 'README.md'), '# Test Repo');
    execSync('git add .', { cwd: tempGitDir, windowsHide: true });
    execSync('git commit -m "Initial commit"', { cwd: tempGitDir, windowsHide: true });

    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => {
    // Clean up temp git repo
    if (tempGitDir && fs.existsSync(tempGitDir)) {
      safeRmSync(tempGitDir);
    }
    return new Promise(resolve => server.close(resolve));
  });

  describe('GET /api/git/check', () => {
    it('should detect a git repository', async () => {
      const res = await request('GET', `/api/git/check?cwd=${encodeURIComponent(tempGitDir)}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.isRepo, true);
    });

    it('should return false for non-git directory', async () => {
      const nonGitDir = path.join(os.tmpdir(), 'test-non-git-' + Date.now());
      fs.mkdirSync(nonGitDir, { recursive: true });

      const res = await request('GET', `/api/git/check?cwd=${encodeURIComponent(nonGitDir)}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.isRepo, false);

      safeRmSync(nonGitDir);
    });
  });

  describe('GET /api/git/status', () => {
    it('should return git status with branch and files', async () => {
      // Create an untracked file
      fs.writeFileSync(path.join(tempGitDir, 'untracked.txt'), 'new content');

      const res = await request('GET', `/api/git/status?cwd=${encodeURIComponent(tempGitDir)}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.branch !== undefined);
      assert.ok(Array.isArray(res.body.data.files));
      assert.ok(res.body.data.files.some(f => f.path === 'untracked.txt'));

      // Clean up
      fs.unlinkSync(path.join(tempGitDir, 'untracked.txt'));
    });
  });

  describe('GET /api/git/diff', () => {
    it('should return git diff', async () => {
      // Modify a tracked file
      fs.writeFileSync(path.join(tempGitDir, 'README.md'), '# Modified');

      const res = await request('GET', `/api/git/diff?cwd=${encodeURIComponent(tempGitDir)}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(typeof res.body.data.diff === 'string');

      // Reset
      execSync('git checkout -- README.md', { cwd: tempGitDir, windowsHide: true });
    });
  });

  describe('GET /api/git/log', () => {
    it('should return git log', async () => {
      const res = await request('GET', `/api/git/log?cwd=${encodeURIComponent(tempGitDir)}&limit=5`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(typeof res.body.data.log === 'string');
      assert.ok(res.body.data.log.includes('Initial commit'));
    });
  });

  describe('GET /api/git/branches', () => {
    it('should list branches', async () => {
      const res = await request('GET', `/api/git/branches?cwd=${encodeURIComponent(tempGitDir)}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.branches));
    });
  });

  describe('POST /api/git/commit', () => {
    it('should require a message', async () => {
      const res = await request('POST', `/api/git/commit?cwd=${encodeURIComponent(tempGitDir)}`, {
        files: ['README.md']
      });

      assert.strictEqual(res.status, 400);
    });

    it('should commit changes', async () => {
      // Create and stage a file
      fs.writeFileSync(path.join(tempGitDir, 'newfile.txt'), 'hello');

      const res = await request('POST', `/api/git/commit?cwd=${encodeURIComponent(tempGitDir)}`, {
        message: 'Add new file',
        files: ['newfile.txt']
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });
  });
});
