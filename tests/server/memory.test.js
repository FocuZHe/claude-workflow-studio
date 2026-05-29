const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// Use a temp directory for test data
const testDir = path.join(__dirname, '../.temp-data', String(Date.now()));

describe('MemoryService', () => {
  let MemoryService;

  before(() => {
    // Create temp directory
    fs.mkdirSync(testDir, { recursive: true });
    // Clear module cache to get fresh instance
    delete require.cache[require.resolve('../../src/server/services/MemoryService')];
    MemoryService = require('../../src/server/services/MemoryService');
    MemoryService.init(testDir);
  });

  after(() => {
    // Cleanup
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
  });

  describe('appendMemoryWithTag', () => {
    it('should append memory with tag', () => {
      MemoryService.appendMemoryWithTag('wf-1', '测试内容', '测试标签');
      const mem = MemoryService.getMemory('wf-1');
      assert.ok(mem.includes('测试内容'));
      assert.ok(mem.includes('测试标签'));
    });

    it('should append multiple entries', () => {
      MemoryService.appendMemoryWithTag('wf-2', '第一条', '标签1');
      MemoryService.appendMemoryWithTag('wf-2', '第二条', '标签2');
      const mem = MemoryService.getMemory('wf-2');
      assert.ok(mem.includes('第一条'));
      assert.ok(mem.includes('第二条'));
    });

    it('should deduplicate identical entries', () => {
      MemoryService.appendMemoryWithTag('wf-3', '重复内容', '测试');
      MemoryService.appendMemoryWithTag('wf-3', '重复内容', '测试');
      const mem = MemoryService.getMemory('wf-3');
      const count = mem.split('## Session').length - 1;
      assert.strictEqual(count, 1);
    });

    it('should not deduplicate different entries', () => {
      MemoryService.appendMemoryWithTag('wf-4', '内容A', '测试');
      MemoryService.appendMemoryWithTag('wf-4', '内容B', '测试');
      const mem = MemoryService.getMemory('wf-4');
      const count = mem.split('## Session').length - 1;
      assert.strictEqual(count, 2);
    });

    it('should truncate long tags to 50 chars', () => {
      const longTag = 'a'.repeat(100);
      MemoryService.appendMemoryWithTag('wf-5', '内容', longTag);
      const mem = MemoryService.getMemory('wf-5');
      // Tag should be truncated
      assert.ok(mem.length < 200);
    });

    it('should return false for empty workflowId', () => {
      const result = MemoryService.appendMemoryWithTag('', '内容', '标签');
      assert.strictEqual(result, false);
    });

    it('should return false for empty entry', () => {
      const result = MemoryService.appendMemoryWithTag('wf-6', '', '标签');
      assert.strictEqual(result, false);
    });
  });

  describe('extractAgentMemory', () => {
    it('should extract [记忆: xxx] markers', () => {
      const output = '完成任务 [记忆: 发现XSS漏洞] 和 [记忆: 需要修复CSRF]';
      const markers = MemoryService.extractAgentMemory(output);
      assert.strictEqual(markers.length, 2);
      assert.strictEqual(markers[0], '发现XSS漏洞');
      assert.strictEqual(markers[1], '需要修复CSRF');
    });

    it('should extract [Memory: xxx] markers', () => {
      const output = 'Done [Memory: important finding]';
      const markers = MemoryService.extractAgentMemory(output);
      assert.strictEqual(markers.length, 1);
      assert.strictEqual(markers[0], 'important finding');
    });

    it('should return empty array for no markers', () => {
      const markers = MemoryService.extractAgentMemory('普通输出内容');
      assert.deepStrictEqual(markers, []);
    });

    it('should return empty array for null input', () => {
      const markers = MemoryService.extractAgentMemory(null);
      assert.deepStrictEqual(markers, []);
    });
  });

  describe('injectMemoryFiltered', () => {
    it('should filter memory by keyword', () => {
      MemoryService.appendMemoryWithTag('wf-filter', '数学笔记内容', '数学笔记');
      MemoryService.appendMemoryWithTag('wf-filter', '英语笔记内容', '英语笔记');

      const filtered = MemoryService.injectMemoryFiltered('wf-filter', '写数学作业');
      assert.ok(filtered.includes('数学笔记'));
      assert.ok(!filtered.includes('英语笔记'));
    });

    it('should return empty for non-matching keywords', () => {
      const filtered = MemoryService.injectMemoryFiltered('wf-filter', '写语文作业');
      assert.strictEqual(filtered, '');
    });

    it('should inject all when no task input', () => {
      const filtered = MemoryService.injectMemoryFiltered('wf-filter', '');
      assert.ok(filtered.length > 0);
    });
  });

  describe('_getMemoryPath validation', () => {
    it('should reject path traversal', () => {
      assert.throws(() => MemoryService._getMemoryPath('../etc/passwd'), /Path traversal/);
    });

    it('should reject slashes', () => {
      assert.throws(() => MemoryService._getMemoryPath('foo/bar'), /Path traversal/);
    });

    it('should reject special characters', () => {
      assert.throws(() => MemoryService._getMemoryPath('foo@bar'), /Invalid workflowId/);
    });

    it('should accept valid UUID', () => {
      const p = MemoryService._getMemoryPath('57302b5b-f2ce-4ad3-a90b-bb00fe4d3d05');
      assert.ok(p.includes('57302b5b-f2ce-4ad3-a90b-bb00fe4d3d05'));
    });
  });

  describe('shared pool', () => {
    it('should get and update shared pool', () => {
      MemoryService.updateSharedPool({ variables: { x: 1 }, notes: ['test'] });
      const pool = MemoryService.getSharedPool();
      assert.strictEqual(pool.variables.x, 1);
      assert.ok(pool.notes.includes('test'));
    });
  });
});
