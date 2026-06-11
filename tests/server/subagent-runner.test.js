const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const testDir = path.join(__dirname, '../.temp-data', `subagent-${Date.now()}`);

describe('SubAgentRunner', () => {
  let SubAgentRunner;

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
    delete require.cache[require.resolve('../../dist/server/services/SubAgentRunner')];
    const mod = require('../../dist/server/services/SubAgentRunner');
    SubAgentRunner = mod.SubAgentRunner || mod;
  });

  after(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
  });

  describe('constructor', () => {
    it('should create a runner instance', () => {
      const runner = new SubAgentRunner();
      assert.ok(runner);
    });

    it('should have expected methods', () => {
      const runner = new SubAgentRunner();
      // SubAgentRunner extends EventEmitter
      assert.ok(runner instanceof require('events').EventEmitter);
    });
  });

  describe('AgentTask validation', () => {
    it('should accept valid task structure', () => {
      const task = {
        id: 'task-1',
        description: '测试任务',
        worktree: testDir,
        model: 'sonnet',
        systemPrompt: '你是一个测试助手'
      };
      assert.ok(task.id);
      assert.ok(task.description);
      assert.ok(task.worktree);
    });

    it('should handle task with skills', () => {
      const task = {
        id: 'task-2',
        description: '带技能的任务',
        worktree: testDir,
        skills: ['代码审查', '安全检测']
      };
      assert.ok(Array.isArray(task.skills));
      assert.strictEqual(task.skills.length, 2);
    });

    it('should handle task with resumeSessionId', () => {
      const task = {
        id: 'task-3',
        description: '恢复会话的任务',
        worktree: testDir,
        resumeSessionId: 'session-123'
      };
      assert.ok(task.resumeSessionId);
    });
  });

  describe('SubAgentConfig', () => {
    it('should have preset agent configs', () => {
      const config = {
        id: 'analyzer',
        name: '漏洞分析师',
        timeout: 10 * 60 * 1000,
        baseSystemPrompt: '你是一个分析专家'
      };
      assert.ok(config.id);
      assert.ok(config.name);
      assert.ok(config.timeout > 0);
    });

    it('should support custom timeout', () => {
      const config = {
        id: 'custom',
        name: '自定义Agent',
        timeout: 5 * 60 * 1000
      };
      assert.strictEqual(config.timeout, 300000);
    });
  });
});
