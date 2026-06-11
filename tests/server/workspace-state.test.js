const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const tempDataDir = process.env.DATA_DIR || path.join(__dirname, '.temp-data');
const WorkspaceStateService = require('../../dist/server/services/WorkspaceStateService');

// Create a temp workspace for testing
const tempWorkspace = path.join(tempDataDir, 'test-workspace');
const workflowsDir = path.join(tempWorkspace, 'WORKFLOWS');

function cleanupWorkspace() {
  try {
    if (fs.existsSync(tempWorkspace)) {
      fs.rmSync(tempWorkspace, { recursive: true });
    }
  } catch (e) { /* ignore */ }
}

describe('WorkspaceStateService', () => {
  beforeEach(() => {
    cleanupWorkspace();
    fs.mkdirSync(tempWorkspace, { recursive: true });
  });

  afterEach(() => {
    cleanupWorkspace();
  });

  describe('ensureWorkflowsFolder', () => {
    it('should create WORKFLOWS dir and all default files', () => {
      WorkspaceStateService.ensureWorkflowsFolder(tempWorkspace);

      const expectedFiles = [
        'manifest.json', 'workflows.json', 'agents.json', 'tasks.json',
        'skills.json', 'mcp-tools.json', 'execution-log.json',
        'chat-sessions.json', 'task-queues.json', 'prompt-templates.json'
      ];

      for (const filename of expectedFiles) {
        const filePath = path.join(workflowsDir, filename);
        assert.ok(fs.existsSync(filePath), `${filename} should exist`);
      }
    });
  });

  describe('loadState', () => {
    it('should include chatSessions in loaded state', () => {
      WorkspaceStateService.ensureWorkflowsFolder(tempWorkspace);

      // Write some chat sessions
      const chatData = [{ id: 'cs-1', title: 'Test Chat', messages: [] }];
      fs.writeFileSync(
        path.join(workflowsDir, 'chat-sessions.json'),
        JSON.stringify(chatData, null, 2), 'utf-8'
      );

      const state = WorkspaceStateService.loadState(tempWorkspace);
      assert.ok(state.chatSessions, 'should have chatSessions');
      assert.strictEqual(state.chatSessions.length, 1);
      assert.strictEqual(state.chatSessions[0].title, 'Test Chat');
    });

    it('should include taskQueues in loaded state', () => {
      WorkspaceStateService.ensureWorkflowsFolder(tempWorkspace);

      const queueData = [{ id: 'tq-1', name: 'Test Queue' }];
      fs.writeFileSync(
        path.join(workflowsDir, 'task-queues.json'),
        JSON.stringify(queueData, null, 2), 'utf-8'
      );

      const state = WorkspaceStateService.loadState(tempWorkspace);
      assert.ok(state.taskQueues, 'should have taskQueues');
      assert.strictEqual(state.taskQueues.length, 1);
      assert.strictEqual(state.taskQueues[0].name, 'Test Queue');
    });

    it('should include promptTemplates in loaded state', () => {
      WorkspaceStateService.ensureWorkflowsFolder(tempWorkspace);

      const templateData = [{ id: 'pt-1', name: 'Test Template', content: 'Hello' }];
      fs.writeFileSync(
        path.join(workflowsDir, 'prompt-templates.json'),
        JSON.stringify(templateData, null, 2), 'utf-8'
      );

      const state = WorkspaceStateService.loadState(tempWorkspace);
      assert.ok(state.promptTemplates, 'should have promptTemplates');
      assert.strictEqual(state.promptTemplates.length, 1);
      assert.strictEqual(state.promptTemplates[0].name, 'Test Template');
    });
  });

  describe('saveState', () => {
    it('should save chat sessions state', (_, done) => {
      WorkspaceStateService.ensureWorkflowsFolder(tempWorkspace);
      const data = [{ id: 'cs-save', title: 'Saved Chat' }];

      WorkspaceStateService.saveState(tempWorkspace, 'chat-sessions', data);

      // saveState is debounced (500ms), wait and check
      setTimeout(() => {
        const filePath = path.join(workflowsDir, 'chat-sessions.json');
        assert.ok(fs.existsSync(filePath));
        const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        assert.strictEqual(saved.length, 1);
        assert.strictEqual(saved[0].title, 'Saved Chat');
        done();
      }, 600);
    });

    it('should save task queues state', (_, done) => {
      WorkspaceStateService.ensureWorkflowsFolder(tempWorkspace);
      const data = [{ id: 'tq-save', name: 'Saved Queue' }];

      WorkspaceStateService.saveState(tempWorkspace, 'task-queues', data);

      setTimeout(() => {
        const filePath = path.join(workflowsDir, 'task-queues.json');
        assert.ok(fs.existsSync(filePath));
        const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        assert.strictEqual(saved.length, 1);
        assert.strictEqual(saved[0].name, 'Saved Queue');
        done();
      }, 600);
    });

    it('should save prompt templates state', (_, done) => {
      WorkspaceStateService.ensureWorkflowsFolder(tempWorkspace);
      const data = [{ id: 'pt-save', name: 'Saved Template', content: 'Test' }];

      WorkspaceStateService.saveState(tempWorkspace, 'prompt-templates', data);

      setTimeout(() => {
        const filePath = path.join(workflowsDir, 'prompt-templates.json');
        assert.ok(fs.existsSync(filePath));
        const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        assert.strictEqual(saved.length, 1);
        assert.strictEqual(saved[0].name, 'Saved Template');
        done();
      }, 600);
    });
  });
});
