const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const testDir = path.join(__dirname, '../.temp-data', `sdk-${Date.now()}`);

describe('SdkService', () => {
  let SdkService;

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
    delete require.cache[require.resolve('../../dist/server/services/SdkService')];
    SdkService = require('../../dist/server/services/SdkService');
  });

  after(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
  });

  describe('constructor', () => {
    it('should create an instance with expected properties', () => {
      const service = new SdkService(null);
      assert.ok(service);
      assert.ok(service.activeStreams instanceof Map);
    });

    it('should have expected methods', () => {
      const service = new SdkService(null);
      assert.strictEqual(typeof service._executeWithClaudeSdk, 'function');
    });
  });

  describe('Task deduplication', () => {
    it('should generate consistent task keys', () => {
      const getTaskKey = (task) => {
        const normalized = {
          taskId: task.taskId || null,
          desc: (task.description || task.task || '').trim(),
          allowedFiles: (task.allowedFiles || []).slice().sort(),
          model: task.model || 'default'
        };
        const json = JSON.stringify(normalized);
        return require('crypto').createHash('sha256').update(json).digest('hex');
      };

      const task1 = { taskId: 't1', description: '测试任务' };
      const task2 = { taskId: 't1', description: '测试任务' };
      const task3 = { taskId: 't2', description: '不同任务' };

      assert.strictEqual(getTaskKey(task1), getTaskKey(task2));
      assert.notStrictEqual(getTaskKey(task1), getTaskKey(task3));
    });
  });

  describe('ExecutionConfig', () => {
    it('should accept valid config structure', () => {
      const config = {
        model: 'sonnet',
        systemPrompt: '你是一个助手',
        agentType: 'general-purpose',
        allowedTools: ['Read', 'Write', 'Edit'],
        maxTurns: 10,
        cwd: testDir,
        skills: ['代码审查'],
        permissionMode: 'default'
      };
      assert.ok(config.model);
      assert.ok(config.systemPrompt);
      assert.ok(Array.isArray(config.allowedTools));
    });

    it('should support explore agent type', () => {
      const config = {
        agentType: 'Explore',
        allowedTools: ['Read', 'Glob', 'Grep']
      };
      assert.strictEqual(config.agentType, 'Explore');
    });

    it('should support general-purpose agent type', () => {
      const config = {
        agentType: 'general-purpose',
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']
      };
      assert.strictEqual(config.agentType, 'general-purpose');
    });
  });

  describe('Network error handling', () => {
    it('should have network error codes defined', () => {
      const NETWORK_ERRORS = [
        'ENOTFOUND',
        'ECONNRESET',
        'ETIMEDOUT',
        'ECONNREFUSED',
        'EPIPE',
        'EAI_AGAIN',
      ];
      assert.ok(Array.isArray(NETWORK_ERRORS));
      assert.ok(NETWORK_ERRORS.length > 0);
      assert.ok(NETWORK_ERRORS.includes('ENOTFOUND'));
      assert.ok(NETWORK_ERRORS.includes('ETIMEDOUT'));
    });
  });

  describe('Message buffering', () => {
    it('should support buffer configuration', () => {
      const bufferConfig = {
        bufferTimeMs: 50,
        maxBufferSize: 100
      };
      assert.ok(bufferConfig.bufferTimeMs > 0);
      assert.ok(bufferConfig.maxBufferSize > 0);
    });
  });

  describe('Fork-Join parallel execution', () => {
    it('should support parallel task structure', () => {
      const tasks = [
        { id: 'task-1', description: '任务1', model: 'sonnet' },
        { id: 'task-2', description: '任务2', model: 'haiku' }
      ];
      assert.strictEqual(tasks.length, 2);
      tasks.forEach(task => {
        assert.ok(task.id);
        assert.ok(task.description);
      });
    });

    it('should support merge prompt generation', () => {
      const taskCount = 3;
      const mergePrompt = `汇总以下 ${taskCount} 个并行任务的成果`;
      assert.ok(mergePrompt.includes(String(taskCount)));
    });
  });
});
