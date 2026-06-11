const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// DATA_DIR is already set to tests/.temp-data by tests/setup.js
const tempDataDir = process.env.DATA_DIR || path.join(__dirname, '.temp-data');

const AgentModel = require('../../dist/server/models/Agent');
const WorkflowModel = require('../../dist/server/models/Workflow');
const ChatSessionModel = require('../../dist/server/models/ChatSession');
const TaskQueueModel = require('../../dist/server/models/TaskQueue');
const PromptTemplateModel = require('../../dist/server/models/PromptTemplate');
const DataStore = require('../../dist/server/utils/DataStore');

function cleanup() {
  // Only remove specific data files, not the entire shared temp dir
  const files = ['agents.json', 'workflows.json', 'chat-sessions.json', 'task-queues.json', 'prompt-templates.json'];
  for (const f of files) {
    const fp = path.join(tempDataDir, f);
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Cleanup failed:', err.message);
    }
  }
}

describe('Agent Model Persistence', () => {
  beforeEach(() => {
    AgentModel.clear();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('should persist agents to file after create', () => {
    AgentModel.create({ name: 'Test Agent', role: 'developer' });
    AgentModel._flush();

    const agentsFile = path.join(tempDataDir, 'agents.json');
    assert.ok(fs.existsSync(agentsFile), 'agents.json should exist');

    const saved = JSON.parse(fs.readFileSync(agentsFile, 'utf-8'));
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].name, 'Test Agent');
    assert.strictEqual(saved[0].role, 'developer');
  });

  it('should persist agents after update', () => {
    const agent = AgentModel.create({ name: 'Test', role: 'developer' });
    AgentModel.update(agent.id, { name: 'Updated' });
    AgentModel._flush();

    const agentsFile = path.join(tempDataDir, 'agents.json');
    const saved = JSON.parse(fs.readFileSync(agentsFile, 'utf-8'));
    assert.strictEqual(saved[0].name, 'Updated');
  });

  it('should persist agents after delete', () => {
    const agent1 = AgentModel.create({ name: 'Agent 1', role: 'developer' });
    AgentModel.create({ name: 'Agent 2', role: 'tester' });
    AgentModel.delete(agent1.id);
    AgentModel._flush();

    const agentsFile = path.join(tempDataDir, 'agents.json');
    const saved = JSON.parse(fs.readFileSync(agentsFile, 'utf-8'));
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].name, 'Agent 2');
  });

  it('should load agents from file on initialization', () => {
    // Create some agents
    AgentModel.create({ name: 'Persisted Agent', role: 'reviewer' });
    AgentModel._flush();

    // Read the file directly
    const agentsFile = path.join(tempDataDir, 'agents.json');
    const savedData = JSON.parse(fs.readFileSync(agentsFile, 'utf-8'));
    assert.strictEqual(savedData.length, 1);

    // Create a new DataStore and verify it loads the same data
    const newStore = new DataStore(agentsFile);
    const loaded = newStore.load();
    assert.strictEqual(loaded.length, 1);
    assert.strictEqual(loaded[0].name, 'Persisted Agent');
    assert.strictEqual(loaded[0].role, 'reviewer');
  });
});

describe('Workflow Model Persistence', () => {
  beforeEach(() => {
    WorkflowModel.clear();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('should persist workflows to file after create', () => {
    WorkflowModel.create({ name: 'Test Workflow' });
    WorkflowModel._flush();

    const workflowsFile = path.join(tempDataDir, 'workflows.json');
    assert.ok(fs.existsSync(workflowsFile), 'workflows.json should exist');

    const saved = JSON.parse(fs.readFileSync(workflowsFile, 'utf-8'));
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].name, 'Test Workflow');
    assert.strictEqual(saved[0].status, 'draft');
  });

  it('should persist workflows after update', () => {
    const wf = WorkflowModel.create({ name: 'Test WF' });
    WorkflowModel.update(wf.id, { name: 'Updated WF', status: 'running' });
    WorkflowModel._flush();

    const workflowsFile = path.join(tempDataDir, 'workflows.json');
    const saved = JSON.parse(fs.readFileSync(workflowsFile, 'utf-8'));
    assert.strictEqual(saved[0].name, 'Updated WF');
    assert.strictEqual(saved[0].status, 'running');
  });

  it('should persist workflows after delete', () => {
    const wf1 = WorkflowModel.create({ name: 'WF 1' });
    WorkflowModel.create({ name: 'WF 2' });
    WorkflowModel.delete(wf1.id);
    WorkflowModel._flush();

    const workflowsFile = path.join(tempDataDir, 'workflows.json');
    const saved = JSON.parse(fs.readFileSync(workflowsFile, 'utf-8'));
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].name, 'WF 2');
  });

  it('should persist workflows after addExecutionLog', () => {
    const wf = WorkflowModel.create({ name: 'Test WF' });
    WorkflowModel.addExecutionLog(wf.id, { event: 'started', timestamp: new Date().toISOString() });
    WorkflowModel._flush();

    const workflowsFile = path.join(tempDataDir, 'workflows.json');
    const saved = JSON.parse(fs.readFileSync(workflowsFile, 'utf-8'));
    assert.strictEqual(saved[0].executionLog.length, 1);
    assert.strictEqual(saved[0].executionLog[0].event, 'started');
  });

  it('should load workflows from file on initialization', () => {
    WorkflowModel.create({ name: 'Persisted Workflow', description: 'A test' });
    WorkflowModel._flush();

    const workflowsFile = path.join(tempDataDir, 'workflows.json');
    const newStore = new DataStore(workflowsFile);
    const loaded = newStore.load();
    assert.strictEqual(loaded.length, 1);
    assert.strictEqual(loaded[0].name, 'Persisted Workflow');
  });
});

describe('ChatSession Model Persistence', () => {
  beforeEach(() => {
    ChatSessionModel.clear();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('should persist chat sessions to file after create', () => {
    ChatSessionModel.create({ title: 'Test Chat' });
    ChatSessionModel._flush();

    const file = path.join(tempDataDir, 'chat-sessions.json');
    assert.ok(fs.existsSync(file), 'chat-sessions.json should exist');

    const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].title, 'Test Chat');
  });

  it('should persist messages added to chat session', () => {
    const session = ChatSessionModel.create({ title: 'Test Chat' });
    ChatSessionModel.addMessage(session.id, { role: 'user', content: 'Hello' });
    ChatSessionModel._flush();

    const file = path.join(tempDataDir, 'chat-sessions.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.strictEqual(saved[0].messages.length, 1);
    assert.strictEqual(saved[0].messages[0].content, 'Hello');
  });

  it('should reload chat sessions from array', () => {
    const sessions = [
      { id: 'cs-1', title: 'Chat A', messages: [], status: 'active' },
      { id: 'cs-2', title: 'Chat B', messages: [], status: 'archived' }
    ];
    ChatSessionModel.reload(sessions);

    const result = ChatSessionModel.findAll();
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(ChatSessionModel.findById('cs-1').title, 'Chat A');
    assert.strictEqual(ChatSessionModel.findById('cs-2').title, 'Chat B');
  });
});

describe('TaskQueue Model Persistence', () => {
  beforeEach(() => {
    TaskQueueModel.clear();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('should persist task queues to file after create', () => {
    TaskQueueModel.create({ name: 'Test Queue' });
    TaskQueueModel._flush();

    const file = path.join(tempDataDir, 'task-queues.json');
    assert.ok(fs.existsSync(file), 'task-queues.json should exist');

    const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].name, 'Test Queue');
  });

  it('should reload task queues from array', () => {
    const queues = [
      { id: 'tq-1', name: 'Queue A', items: [], tasks: [] },
      { id: 'tq-2', name: 'Queue B', items: [], tasks: [] }
    ];
    TaskQueueModel.reload(queues);

    assert.strictEqual(TaskQueueModel.findById('tq-1').name, 'Queue A');
    assert.strictEqual(TaskQueueModel.findById('tq-2').name, 'Queue B');
  });
});

describe('PromptTemplate Model Persistence', () => {
  beforeEach(() => {
    PromptTemplateModel.clear();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('should persist prompt templates to file after create', () => {
    PromptTemplateModel.create({ name: 'Test Template', content: 'You are a helpful assistant' });
    PromptTemplateModel._flush();

    const file = path.join(tempDataDir, 'prompt-templates.json');
    assert.ok(fs.existsSync(file), 'prompt-templates.json should exist');

    const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].name, 'Test Template');
  });

  it('should reload prompt templates from array', () => {
    const templates = [
      { id: 'pt-1', name: 'Template A', content: 'Hello' },
      { id: 'pt-2', name: 'Template B', content: 'World' }
    ];
    PromptTemplateModel.reload(templates);

    assert.strictEqual(PromptTemplateModel.findById('pt-1').name, 'Template A');
    assert.strictEqual(PromptTemplateModel.findById('pt-2').name, 'Template B');
  });
});
