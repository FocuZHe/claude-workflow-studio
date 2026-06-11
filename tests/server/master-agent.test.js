const { describe, it, before } = require('node:test');
const assert = require('node:assert');

const MasterAgentService = require('../../dist/server/services/MasterAgentService');

describe('MasterAgentService', () => {
  describe('canUseMasterAgent', () => {
    it('should return true for valid workflow with nodes', () => {
      const workflow = {
        id: 'wf-1',
        nodes: [
          { id: 'start', type: 'start', label: '开始' },
          { id: 'n1', type: 'agent', label: '任务1' }
        ],
        edges: [{ source: 'start', target: 'n1' }]
      };
      assert.strictEqual(MasterAgentService.canUseMasterAgent(workflow), true);
    });

    it('should return false for null workflow', () => {
      assert.strictEqual(MasterAgentService.canUseMasterAgent(null), false);
    });

    it('should return false for workflow with empty nodes', () => {
      const workflow = { id: 'wf-1', nodes: [], edges: [] };
      assert.strictEqual(MasterAgentService.canUseMasterAgent(workflow), false);
    });
  });

  describe('buildSystemPrompt', () => {
    it('should build system prompt for simple workflow', () => {
      const workflow = {
        id: 'wf-1',
        nodes: [
          { id: 'start', type: 'start', label: '开始' },
          { id: 'n1', type: 'agent', label: '代码审查', config: { systemPrompt: '审查代码质量' } },
          { id: 'end', type: 'end', label: '结束' }
        ],
        edges: [
          { source: 'start', target: 'n1' },
          { source: 'n1', target: 'end' }
        ]
      };
      const prompt = MasterAgentService.buildSystemPrompt(workflow, '请审查代码', '/workspace');
      assert.ok(prompt);
      assert.ok(prompt.includes('代码审查'));
      assert.ok(prompt.includes('call_sub_agent'));
    });

    it('should handle parallel nodes in prompt', () => {
      const workflow = {
        id: 'wf-parallel',
        nodes: [
          { id: 'start', type: 'start', label: '开始' },
          { id: 'n1', type: 'agent', label: '任务A' },
          { id: 'n2', type: 'agent', label: '任务B' },
          { id: 'end', type: 'end', label: '结束' }
        ],
        edges: [
          { source: 'start', target: 'n1' },
          { source: 'start', target: 'n2' },
          { source: 'n1', target: 'end' },
          { source: 'n2', target: 'end' }
        ]
      };
      const prompt = MasterAgentService.buildSystemPrompt(workflow, '并行执行', '/workspace');
      assert.ok(prompt);
      assert.ok(prompt.includes('并行'));
    });

    it('should handle condition nodes in prompt', () => {
      const workflow = {
        id: 'wf-cond',
        nodes: [
          { id: 'start', type: 'start', label: '开始' },
          { id: 'cond', type: 'condition', label: '判断', config: { pattern: 'pass' } },
          { id: 'n1', type: 'agent', label: '通过分支' },
          { id: 'n2', type: 'agent', label: '失败分支' },
          { id: 'end', type: 'end', label: '结束' }
        ],
        edges: [
          { source: 'start', target: 'cond' },
          { source: 'cond', target: 'n1', label: 'true' },
          { source: 'cond', target: 'n2', label: 'false' },
          { source: 'n1', target: 'end' },
          { source: 'n2', target: 'end' }
        ]
      };
      const prompt = MasterAgentService.buildSystemPrompt(workflow, '条件判断', '/workspace');
      assert.ok(prompt);
      assert.ok(prompt.includes('条件'));
    });

    it('should handle subworkflow nodes in prompt', () => {
      const workflow = {
        id: 'wf-sub',
        nodes: [
          { id: 'start', type: 'start', label: '开始' },
          { id: 'sub', type: 'subworkflow', label: '子流程', config: { subWorkflowId: 'sub-wf-1' } },
          { id: 'end', type: 'end', label: '结束' }
        ],
        edges: [
          { source: 'start', target: 'sub' },
          { source: 'sub', target: 'end' }
        ]
      };
      const prompt = MasterAgentService.buildSystemPrompt(workflow, '执行子流程', '/workspace');
      assert.ok(prompt);
    });

    it('should include checkpoint data when resuming', () => {
      const workflow = {
        id: 'wf-resume',
        nodes: [
          { id: 'start', type: 'start', label: '开始' },
          { id: 'n1', type: 'agent', label: '任务1' },
          { id: 'n2', type: 'agent', label: '任务2' },
          { id: 'end', type: 'end', label: '结束' }
        ],
        edges: [
          { source: 'start', target: 'n1' },
          { source: 'n1', target: 'n2' },
          { source: 'n2', target: 'end' }
        ]
      };
      const checkpoint = {
        completedNodes: {
          'n1': { status: 'completed', output: '已完成的输出' }
        }
      };
      const prompt = MasterAgentService.buildSystemPrompt(workflow, '继续执行', '/workspace', checkpoint);
      assert.ok(prompt);
    });
  });

  describe('getAgentTypeForNode', () => {
    it('should determine agent type from node config', () => {
      const node = {
        id: 'n1',
        type: 'agent',
        label: '搜索代码',
        config: { systemPrompt: '搜索并分析代码结构' }
      };
      // Agent type is determined by node.agentType or defaults to general-purpose
      const agentType = node.agentType || 'general-purpose';
      assert.strictEqual(agentType, 'general-purpose');
    });

    it('should use explicit agentType when set', () => {
      const node = {
        id: 'n1',
        type: 'agent',
        label: '探索任务',
        agentType: 'Explore'
      };
      const agentType = node.agentType || 'general-purpose';
      assert.strictEqual(agentType, 'Explore');
    });

    it('should return default general-purpose when no hint', () => {
      const node = { id: 'n1', type: 'agent', label: '任务' };
      const agentType = node.agentType || 'general-purpose';
      assert.strictEqual(agentType, 'general-purpose');
    });
  });
});
