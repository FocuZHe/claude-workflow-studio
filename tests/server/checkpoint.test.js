const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const testDir = path.join(__dirname, '../.temp-data', `checkpoint-${Date.now()}`);

describe('CheckpointService', () => {
  let CheckpointService;

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
    delete require.cache[require.resolve('../../dist/server/services/CheckpointService')];
    CheckpointService = require('../../dist/server/services/CheckpointService');
    CheckpointService.init(testDir);
  });

  after(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
  });

  describe('saveCheckpoint', () => {
    it('should save a checkpoint with completed nodes', () => {
      const result = CheckpointService.saveCheckpoint('wf-1', 'run-1', {
        completedNodes: {
          'node-1': { status: 'completed', output: 'output-1' },
          'node-2': { status: 'completed', output: 'output-2' }
        }
      });
      assert.ok(result);
      assert.strictEqual(result.workflowId, 'wf-1');
      assert.strictEqual(result.runId, 'run-1');
    });

    it('should save checkpoint with metadata', () => {
      const result = CheckpointService.saveCheckpoint('wf-2', 'run-1', {
        completedNodes: {
          'node-1': {
            status: 'completed',
            output: 'test output',
            duration: 5000,
            model: 'sonnet'
          }
        }
      });
      assert.ok(result);
      assert.strictEqual(result.completedNodes['node-1'].duration, 5000);
      assert.strictEqual(result.completedNodes['node-1'].model, 'sonnet');
    });

    it('should return null for invalid inputs', () => {
      const result = CheckpointService.saveCheckpoint('', '', {});
      assert.strictEqual(result, null);
    });
  });

  describe('loadCheckpoint', () => {
    it('should load an existing checkpoint', () => {
      CheckpointService.saveCheckpoint('wf-load', 'run-1', {
        completedNodes: { 'n1': { status: 'completed', output: 'out' } }
      });
      const checkpoint = CheckpointService.loadCheckpoint('wf-load', 'run-1');
      assert.ok(checkpoint);
      assert.strictEqual(checkpoint.workflowId, 'wf-load');
    });

    it('should return null for non-existent checkpoint', () => {
      const checkpoint = CheckpointService.loadCheckpoint('nonexistent', 'nonexistent');
      assert.strictEqual(checkpoint, null);
    });
  });

  describe('getLatestCheckpoint', () => {
    it('should return the latest checkpoint for a workflow', () => {
      CheckpointService.saveCheckpoint('wf-latest', 'run-1', {
        completedNodes: { 'n1': { status: 'completed', output: 'out1' } }
      });
      CheckpointService.saveCheckpoint('wf-latest', 'run-2', {
        completedNodes: { 'n2': { status: 'completed', output: 'out2' } }
      });
      const latest = CheckpointService.getLatestCheckpoint('wf-latest');
      assert.ok(latest);
      assert.strictEqual(latest.runId, 'run-2');
    });

    it('should return null for workflow with no checkpoints', () => {
      const latest = CheckpointService.getLatestCheckpoint('no-checkpoints');
      assert.strictEqual(latest, null);
    });
  });

  describe('listCheckpoints', () => {
    it('should list all checkpoints for a workflow', () => {
      CheckpointService.saveCheckpoint('wf-list', 'run-1', { completedNodes: {} });
      CheckpointService.saveCheckpoint('wf-list', 'run-2', { completedNodes: {} });
      CheckpointService.saveCheckpoint('wf-list', 'run-3', { completedNodes: {} });
      const list = CheckpointService.listCheckpoints('wf-list');
      assert.strictEqual(list.length, 3);
    });

    it('should return empty array for workflow with no checkpoints', () => {
      const list = CheckpointService.listCheckpoints('empty-wf');
      assert.deepStrictEqual(list, []);
    });
  });

  describe('deleteCheckpoint', () => {
    it('should delete a specific checkpoint', () => {
      CheckpointService.saveCheckpoint('wf-del', 'run-1', { completedNodes: {} });
      const deleted = CheckpointService.deleteCheckpoint('wf-del', 'run-1');
      assert.strictEqual(deleted, true);
      const loaded = CheckpointService.loadCheckpoint('wf-del', 'run-1');
      assert.strictEqual(loaded, null);
    });

    it('should handle non-existent checkpoint gracefully', () => {
      const deleted = CheckpointService.deleteCheckpoint('nonexistent', 'nonexistent');
      // Implementation may return true or false for non-existent
      assert.ok(typeof deleted === 'boolean');
    });
  });

  describe('deleteAllCheckpoints', () => {
    it('should delete all checkpoints for a workflow', () => {
      CheckpointService.saveCheckpoint('wf-delall', 'run-1', { completedNodes: {} });
      CheckpointService.saveCheckpoint('wf-delall', 'run-2', { completedNodes: {} });
      const deleted = CheckpointService.deleteAllCheckpoints('wf-delall');
      assert.strictEqual(deleted, true);
      const list = CheckpointService.listCheckpoints('wf-delall');
      assert.strictEqual(list.length, 0);
    });
  });
});
