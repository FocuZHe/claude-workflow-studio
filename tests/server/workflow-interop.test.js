const { describe, it } = require('node:test');
const assert = require('node:assert');

// Clear module cache
delete require.cache[require.resolve('../../src/server/services/WorkflowInteropService')];
const WorkflowInteropService = require('../../src/server/services/WorkflowInteropService');

describe('WorkflowInteropService', () => {
  describe('parseMarkdown', () => {
    it('should parse frontmatter and steps', () => {
      const md = '---\ndescription: Test\nmodel: sonnet\n---\n\n## 步骤 1：审查\n检查代码\n\n## 步骤 2：修复\n修复问题';
      const result = WorkflowInteropService.parseMarkdown(md);
      assert.strictEqual(result.description, 'Test');
      assert.strictEqual(result.model, 'sonnet');
      assert.strictEqual(result.steps.length, 2);
      assert.strictEqual(result.steps[0].label, '审查');
      assert.strictEqual(result.steps[1].label, '修复');
    });

    it('should handle no frontmatter', () => {
      const md = '## 步骤 1：测试\n内容';
      const result = WorkflowInteropService.parseMarkdown(md);
      assert.strictEqual(result.description, '');
      assert.strictEqual(result.steps.length, 1);
    });

    it('should handle no steps', () => {
      const md = '---\ndescription: Test\n---\n\nSome content';
      const result = WorkflowInteropService.parseMarkdown(md);
      assert.strictEqual(result.steps.length, 1);
      assert.strictEqual(result.steps[0].label, '执行任务');
    });

    it('should handle number-only step format', () => {
      const md = '## 1: Review\nCheck code\n\n## 2: Fix\nFix issues';
      const result = WorkflowInteropService.parseMarkdown(md);
      assert.strictEqual(result.steps.length, 2);
    });
  });

  describe('toWorkflowDag', () => {
    it('should generate correct nodes and edges', () => {
      const parsed = { description: 'Test', model: 'sonnet', steps: [{ label: '审查', content: '检查' }, { label: '修复', content: '修复' }] };
      const dag = WorkflowInteropService.toWorkflowDag(parsed);
      // start + 2 agents + end = 4 nodes
      assert.strictEqual(dag.nodes.length, 4);
      assert.strictEqual(dag.edges.length, 3);
      assert.strictEqual(dag.nodes[0].type, 'start');
      assert.strictEqual(dag.nodes[1].type, 'agent');
      assert.strictEqual(dag.nodes[2].type, 'agent');
      assert.strictEqual(dag.nodes[3].type, 'end');
    });

    it('should set model from parsed config', () => {
      const parsed = { description: 'Test', model: 'haiku', steps: [{ label: '任务', content: '做' }] };
      const dag = WorkflowInteropService.toWorkflowDag(parsed);
      assert.strictEqual(dag.nodes[1].config.model, 'haiku');
    });
  });

  describe('toMarkdown', () => {
    it('should export workflow to markdown', () => {
      const workflow = {
        name: '测试工作流',
        nodes: [
          { id: 'n1', type: 'start', label: '开始', config: {} },
          { id: 'n2', type: 'agent', label: '审查', config: { systemPrompt: '检查代码', model: 'sonnet' } },
          { id: 'n3', type: 'end', label: '结束', config: {} }
        ],
        edges: [{ source: 'n1', target: 'n2' }, { source: 'n2', target: 'n3' }]
      };
      const md = WorkflowInteropService.toMarkdown(workflow);
      assert.ok(md.includes('description: 测试工作流'));
      assert.ok(md.includes('model: sonnet'));
      assert.ok(md.includes('## 步骤 1：审查'));
      assert.ok(md.includes('检查代码'));
    });

    it('should handle workflow with no agent nodes', () => {
      const workflow = {
        name: '空工作流',
        nodes: [
          { id: 'n1', type: 'start', label: '开始', config: {} },
          { id: 'n2', type: 'end', label: '结束', config: {} }
        ],
        edges: [{ source: 'n1', target: 'n2' }]
      };
      const md = WorkflowInteropService.toMarkdown(workflow);
      assert.ok(md.includes('description: 空工作流'));
    });
  });

  describe('roundtrip', () => {
    it('should preserve content through import -> export', () => {
      const original = '---\ndescription: Roundtrip Test\nmodel: sonnet\n---\n\n## 步骤 1：审查\n检查代码质量\n\n## 步骤 2：修复\n修复发现的问题';
      const parsed = WorkflowInteropService.parseMarkdown(original);
      const dag = WorkflowInteropService.toWorkflowDag(parsed);
      const exported = WorkflowInteropService.toMarkdown({ name: 'Roundtrip Test', nodes: dag.nodes, edges: dag.edges });
      assert.ok(exported.includes('检查代码质量'));
      assert.ok(exported.includes('修复发现的问题'));
    });
  });
});
