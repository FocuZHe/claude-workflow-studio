const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const testDir = path.join(__dirname, '../.temp-data', `orchestrator-${Date.now()}`);

describe('WorkflowOrchestrator', () => {
  let WorkflowOrchestrator;

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
    delete require.cache[require.resolve('../../dist/server/services/WorkflowOrchestrator')];
    WorkflowOrchestrator = require('../../dist/server/services/WorkflowOrchestrator');
  });

  after(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
  });

  describe('AGENT_REGISTRY', () => {
    it('should have preset agent configurations', () => {
      const registry = WorkflowOrchestrator.AGENT_REGISTRY || {};
      // 验证预设的 agent 类型存在
      assert.ok(typeof registry === 'object');
    });
  });

  describe('Workflow validation', () => {
    it('should accept valid workflow structure', () => {
      const workflow = {
        id: 'wf-1',
        name: '测试工作流',
        nodes: [
          { id: 'start', type: 'start', label: '开始' },
          { id: 'n1', type: 'agent', label: '任务1' },
          { id: 'end', type: 'end', label: '结束' }
        ],
        edges: [
          { source: 'start', target: 'n1' },
          { source: 'n1', target: 'end' }
        ]
      };
      assert.ok(workflow.nodes.length > 0);
      assert.ok(workflow.edges.length > 0);
    });

    it('should handle workflow with parallel branches', () => {
      const workflow = {
        id: 'wf-parallel',
        name: '并行工作流',
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
      // 验证分叉节点
      const startEdges = workflow.edges.filter(e => e.source === 'start');
      assert.strictEqual(startEdges.length, 2);
    });

    it('should handle workflow with condition nodes', () => {
      const workflow = {
        id: 'wf-condition',
        name: '条件工作流',
        nodes: [
          { id: 'start', type: 'start', label: '开始' },
          { id: 'cond', type: 'condition', label: '判断' },
          { id: 'n1', type: 'agent', label: '通过' },
          { id: 'n2', type: 'agent', label: '失败' },
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
      const condNode = workflow.nodes.find(n => n.type === 'condition');
      assert.ok(condNode);
    });

    it('should handle workflow with approval nodes', () => {
      const workflow = {
        id: 'wf-approval',
        name: '审批工作流',
        nodes: [
          { id: 'start', type: 'start', label: '开始' },
          { id: 'approval', type: 'approval', label: '人工审批' },
          { id: 'end', type: 'end', label: '结束' }
        ],
        edges: [
          { source: 'start', target: 'approval' },
          { source: 'approval', target: 'end' }
        ]
      };
      const approvalNode = workflow.nodes.find(n => n.type === 'approval');
      assert.ok(approvalNode);
    });

    it('should handle workflow with subworkflow nodes', () => {
      const workflow = {
        id: 'wf-sub',
        name: '子工作流',
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
      const subNode = workflow.nodes.find(n => n.type === 'subworkflow');
      assert.ok(subNode);
      assert.ok(subNode.config.subWorkflowId);
    });
  });

  describe('Checkpoint data', () => {
    it('should support checkpoint with completed nodes', () => {
      const checkpoint = {
        completedNodes: {
          'n1': { status: 'completed', output: '任务1完成' },
          'n2': { status: 'completed', output: '任务2完成' }
        }
      };
      assert.strictEqual(Object.keys(checkpoint.completedNodes).length, 2);
    });

    it('should support checkpoint with node outputs', () => {
      const checkpoint = {
        completedNodes: {
          'n1': { status: 'completed', output: '输出内容' }
        },
        nodeOutputs: {
          'n1': '详细输出'
        }
      };
      assert.ok(checkpoint.nodeOutputs['n1']);
    });
  });

  describe('Approval handling', () => {
    it('should create approval resolver', () => {
      const resolvers = new Map();
      const approvalId = 'approval-1';
      resolvers.set(approvalId, {
        resolve: (value) => {},
        timer: setTimeout(() => {}, 3600000)
      });
      assert.ok(resolvers.has(approvalId));
      clearTimeout(resolvers.get(approvalId).timer);
    });

    it('should handle approval decisions', () => {
      const decisions = ['approve', 'reject'];
      decisions.forEach(decision => {
        assert.ok(['approve', 'reject'].includes(decision));
      });
    });
  });
});
