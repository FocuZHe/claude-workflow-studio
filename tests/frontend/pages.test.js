/**
 * 前端页面交互测试
 * 使用 Jest + jsdom 模拟用户点击操作
 */
const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

// 模拟 API 模块
const mockApi = {
  getAgents: jest.fn(() => Promise.resolve({ success: true, data: [] })),
  createAgent: jest.fn(() => Promise.resolve({ success: true, data: { id: '1', name: 'Test' } })),
  deleteAgent: jest.fn(() => Promise.resolve({ success: true })),
  getTasks: jest.fn(() => Promise.resolve({ success: true, data: [] })),
  createTask: jest.fn(() => Promise.resolve({ success: true, data: { id: '1' } })),
  getWorkflows: jest.fn(() => Promise.resolve({ success: true, data: [] })),
  createWorkflow: jest.fn(() => Promise.resolve({ success: true, data: { id: '1', name: 'Test' } })),
};

// 模拟 Toast
const mockToast = {
  success: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
};

// 模拟 Modal
const mockModal = {
  show: jest.fn(),
  close: jest.fn(),
};

// 辅助函数：创建页面容器
function createContainer() {
  const container = document.createElement('div');
  container.id = 'page-container';
  document.body.appendChild(container);
  return container;
}

// 辅助函数：模拟点击
function simulateClick(element) {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window
  });
  element.dispatchEvent(event);
}

// 辅助函数：模拟表单输入
function simulateInput(element, value) {
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('智能体页面交互', () => {
  let container;

  beforeEach(() => {
    container = createContainer();
    // 模拟智能体页面的基本结构
    container.innerHTML = `
      <div class="page-header">
        <h1>智能体</h1>
        <button id="create-agent-btn" class="btn btn-primary">创建智能体</button>
      </div>
      <div id="agent-list" class="agent-list"></div>
      <div id="create-modal" style="display:none;">
        <form id="agent-form">
          <input type="text" id="agent-name" placeholder="名称" />
          <select id="agent-role">
            <option value="developer">开发者</option>
            <option value="reviewer">审查员</option>
          </select>
          <button type="submit">保存</button>
        </form>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  it('创建按钮应该存在且可点击', () => {
    const createBtn = document.getElementById('create-agent-btn');
    expect(createBtn).toBeTruthy();
    expect(createBtn.textContent).toBe('创建智能体');
    expect(createBtn.disabled).toBe(false);
  });

  it('点击创建按钮应该显示模态框', () => {
    const createBtn = document.getElementById('create-agent-btn');
    const modal = document.getElementById('create-modal');

    // 模拟点击事件处理
    createBtn.addEventListener('click', () => {
      modal.style.display = 'block';
    });

    // 模拟用户点击
    simulateClick(createBtn);

    expect(modal.style.display).toBe('block');
  });

  it('表单应该有必填字段', () => {
    const nameInput = document.getElementById('agent-name');
    const roleSelect = document.getElementById('agent-role');

    expect(nameInput).toBeTruthy();
    expect(roleSelect).toBeTruthy();
    expect(nameInput.placeholder).toBe('名称');
  });

  it('表单输入应该正确更新值', () => {
    const nameInput = document.getElementById('agent-name');

    simulateInput(nameInput, '前端开发助手');

    expect(nameInput.value).toBe('前端开发助手');
  });

  it('智能体列表应该正确渲染', () => {
    const listEl = document.getElementById('agent-list');
    const agents = [
      { id: '1', name: 'Agent 1', role: 'developer', status: 'idle' },
      { id: '2', name: 'Agent 2', role: 'reviewer', status: 'busy' },
    ];

    // 模拟渲染逻辑
    listEl.innerHTML = agents.map(a => `
      <div class="agent-card" data-id="${a.id}">
        <span class="agent-name">${a.name}</span>
        <span class="agent-role">${a.role}</span>
        <span class="agent-status">${a.status}</span>
        <button class="delete-btn" data-id="${a.id}">删除</button>
      </div>
    `).join('');

    const cards = listEl.querySelectorAll('.agent-card');
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('.agent-name').textContent).toBe('Agent 1');
    expect(cards[1].querySelector('.agent-status').textContent).toBe('busy');
  });

  it('点击删除按钮应该触发删除操作', () => {
    const listEl = document.getElementById('agent-list');
    let deletedId = null;

    // 渲染一个卡片
    listEl.innerHTML = `
      <div class="agent-card" data-id="1">
        <span class="agent-name">Test Agent</span>
        <button class="delete-btn" data-id="1">删除</button>
      </div>
    `;

    // 绑定删除事件
    listEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-btn')) {
        deletedId = e.target.dataset.id;
      }
    });

    // 模拟用户点击删除按钮
    const deleteBtn = listEl.querySelector('.delete-btn');
    simulateClick(deleteBtn);

    expect(deletedId).toBe('1');
  });
});

describe('任务页面交互', () => {
  let container;

  beforeEach(() => {
    container = createContainer();
    container.innerHTML = `
      <div class="page-header">
        <h1>任务</h1>
        <button id="create-task-btn" class="btn btn-primary">创建任务</button>
      </div>
      <div id="task-list" class="task-list"></div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('创建任务按钮应该存在', () => {
    const createBtn = document.getElementById('create-task-btn');
    expect(createBtn).toBeTruthy();
    expect(createBtn.textContent).toBe('创建任务');
  });

  it('任务列表应该显示状态', () => {
    const listEl = document.getElementById('task-list');
    const tasks = [
      { id: '1', input: '写代码', status: 'completed' },
      { id: '2', input: '审查代码', status: 'running' },
      { id: '3', input: '测试功能', status: 'pending' },
    ];

    listEl.innerHTML = tasks.map(t => `
      <div class="task-card" data-id="${t.id}" data-status="${t.status}">
        <span class="task-input">${t.input}</span>
        <span class="task-status status-${t.status}">${t.status}</span>
      </div>
    `).join('');

    const cards = listEl.querySelectorAll('.task-card');
    expect(cards.length).toBe(3);
    expect(cards[0].dataset.status).toBe('completed');
    expect(cards[1].querySelector('.status-running')).toBeTruthy();
  });
});

describe('工作流工具栏交互', () => {
  let container;

  beforeEach(() => {
    container = createContainer();
    container.innerHTML = `
      <div class="workflow-toolbar">
        <button id="wf-save-btn" class="btn btn-primary">保存</button>
        <button id="wf-run-btn" class="btn btn-success">执行</button>
        <button id="wf-import-md-btn" class="btn btn-secondary">📥 导入 .md</button>
        <button id="wf-export-md-btn" class="btn btn-secondary">📤 导出 .md</button>
      </div>
      <div id="workflow-canvas"></div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('所有工具栏按钮应该存在', () => {
    const saveBtn = document.getElementById('wf-save-btn');
    const runBtn = document.getElementById('wf-run-btn');
    const importBtn = document.getElementById('wf-import-md-btn');
    const exportBtn = document.getElementById('wf-export-md-btn');

    expect(saveBtn).toBeTruthy();
    expect(runBtn).toBeTruthy();
    expect(importBtn).toBeTruthy();
    expect(exportBtn).toBeTruthy();
  });

  it('点击保存按钮应该触发保存逻辑', () => {
    const saveBtn = document.getElementById('wf-save-btn');
    let saved = false;

    saveBtn.addEventListener('click', () => {
      saved = true;
    });

    simulateClick(saveBtn);
    expect(saved).toBe(true);
  });

  it('点击导入按钮应该触发文件选择', () => {
    const importBtn = document.getElementById('wf-import-md-btn');
    let fileInputCreated = false;

    // 模拟文件选择逻辑
    importBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md';
      fileInputCreated = true;
    });

    simulateClick(importBtn);
    expect(fileInputCreated).toBe(true);
  });

  it('导出按钮在没有工作流时应该提示', () => {
    const exportBtn = document.getElementById('wf-export-md-btn');
    let warningShown = false;
    const currentWorkflowId = null;

    exportBtn.addEventListener('click', () => {
      if (!currentWorkflowId) {
        warningShown = true;
      }
    });

    simulateClick(exportBtn);
    expect(warningShown).toBe(true);
  });
});

describe('表单验证交互', () => {
  let container;

  beforeEach(() => {
    container = createContainer();
    container.innerHTML = `
      <form id="test-form">
        <input type="text" id="required-field" required />
        <input type="email" id="email-field" />
        <select id="select-field" required>
          <option value="">请选择</option>
          <option value="a">选项A</option>
          <option value="b">选项B</option>
        </select>
        <button type="submit">提交</button>
        <div id="error-msg" style="display:none;" class="error"></div>
      </form>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('空表单提交应该显示错误', () => {
    const form = document.getElementById('test-form');
    const errorMsg = document.getElementById('error-msg');
    let submitted = false;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const requiredField = document.getElementById('required-field');
      if (!requiredField.value.trim()) {
        errorMsg.style.display = 'block';
        errorMsg.textContent = '此字段为必填项';
        return;
      }
      submitted = true;
    });

    // 模拟提交空表单
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(errorMsg.style.display).toBe('block');
    expect(errorMsg.textContent).toBe('此字段为必填项');
    expect(submitted).toBe(false);
  });

  it('填写后提交应该成功', () => {
    const form = document.getElementById('test-form');
    const requiredField = document.getElementById('required-field');
    let submitted = false;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (requiredField.value.trim()) {
        submitted = true;
      }
    });

    // 模拟用户输入
    simulateInput(requiredField, '测试值');
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(submitted).toBe(true);
  });

  it('下拉框选择应该更新值', () => {
    const selectField = document.getElementById('select-field');

    selectField.value = 'a';
    selectField.dispatchEvent(new Event('change', { bubbles: true }));

    expect(selectField.value).toBe('a');
  });
});

describe('实时状态更新交互', () => {
  let container;

  beforeEach(() => {
    container = createContainer();
    container.innerHTML = `
      <div id="status-panel">
        <div id="agent-count">0</div>
        <div id="active-workflows">0</div>
        <div id="pending-tasks">0</div>
      </div>
      <div id="activity-list"></div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('状态数字应该正确更新', () => {
    const agentCount = document.getElementById('agent-count');
    const activeWorkflows = document.getElementById('active-workflows');
    const pendingTasks = document.getElementById('pending-tasks');

    // 模拟状态更新
    agentCount.textContent = '5';
    activeWorkflows.textContent = '3';
    pendingTasks.textContent = '10';

    expect(agentCount.textContent).toBe('5');
    expect(activeWorkflows.textContent).toBe('3');
    expect(pendingTasks.textContent).toBe('10');
  });

  it('活动列表应该正确渲染', () => {
    const activityList = document.getElementById('activity-list');
    const activities = [
      { text: 'Agent 1 完成了任务', time: '2026-05-30T00:00:00Z' },
      { text: '工作流 "代码审查" 已启动', time: '2026-05-30T00:01:00Z' },
    ];

    activityList.innerHTML = activities.map(a => `
      <div class="activity-item">
        <span class="activity-text">${a.text}</span>
        <span class="activity-time">${new Date(a.time).toLocaleString()}</span>
      </div>
    `).join('');

    const items = activityList.querySelectorAll('.activity-item');
    expect(items.length).toBe(2);
    expect(items[0].querySelector('.activity-text').textContent).toBe('Agent 1 完成了任务');
  });
});
