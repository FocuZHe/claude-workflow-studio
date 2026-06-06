"use strict";
window.TaskCreate = (() => {
    let _isBatchMode = false;
    let _batchItems = [{ input: '' }];
    let _cachedWorkflows = {}; // wsId → workflows list
    function open(agents, workflows, onSubmit) {
        // Support both old signature (agents, onSubmit) and new (agents, workflows, onSubmit)
        if (typeof workflows === 'function') {
            onSubmit = workflows;
            workflows = [];
        }
        _isBatchMode = false;
        _batchItems = [{ input: '' }];
        _cachedWorkflows = {};
        Modal.open({
            title: '创建新任务',
            body: renderForm(agents),
            footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="task-submit-btn">创建任务</button>
      `,
        });
        bindEvents(agents, onSubmit);
    }
    function renderForm(agents) {
        return `
      <!-- Batch mode toggle -->
      <div class="form-group" style="margin-bottom:12px;padding:8px 12px;background:var(--bg-secondary);border-radius:var(--border-radius);border:1px solid var(--border-subtle);">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
          <input type="checkbox" id="batch-mode-toggle">
          <span style="font-weight:600;">批量模式</span>
          <span style="color:var(--text-muted);font-size:11px;">(创建任务队列)</span>
        </label>
      </div>

      <!-- Single task form -->
      <div id="single-task-form">
        <div class="form-group">
          <label class="form-label">标题 *</label>
          <input class="input" id="task-title" placeholder="任务标题" maxlength="200">
        </div>
        <div class="form-group">
          <label class="form-label">描述</label>
          <textarea class="textarea" id="task-desc" placeholder="任务描述" maxlength="2000" rows="3"></textarea>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">优先级</label>
            <select class="select" id="task-priority">
              <option value="low">低</option>
              <option value="medium" selected>中</option>
              <option value="high">高</option>
              <option value="urgent">紧急</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">所属工作区 *</label>
            <select class="select" id="task-workspace">
              <option value="">加载中...</option>
            </select>
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">关联工作流</label>
            <select class="select" id="task-workflow" disabled>
              <option value="">请先选择工作区</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">分配智能体</label>
            <select class="select" id="task-agent">
              <option value="">未分配</option>
              ${(agents || []).map(a => `<option value="${a.id}">${escapeHtml(a.name)} (${a.role})</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">工作文件夹</label>
          <div style="display:flex;gap:8px;">
            <input class="input" id="task-folder-path" placeholder="留空则使用工作区文件夹" style="flex:1;">
            <button class="btn btn-sm btn-secondary" id="task-browse-folder">浏览</button>
          </div>
          <div class="form-hint" id="task-folder-hint" style="margin-top:4px;font-size:11px;color:var(--text-muted);"></div>
        </div>
        <div class="form-group">
          <label class="form-label">输入 / 提示词</label>
          <textarea class="textarea" id="task-input" placeholder="智能体应该做什么？" rows="4"></textarea>
        </div>
        <div class="form-group" style="margin-top:8px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="task-auto-execute">
            <span>创建后立即执行</span>
          </label>
        </div>
      </div>

      <!-- Batch task form (hidden by default) -->
      <div id="batch-task-form" style="display:none;">
        <div class="form-group">
          <label class="form-label">队列名称 *</label>
          <input class="input" id="batch-name" placeholder="输入队列名称" maxlength="200">
        </div>
        <div class="form-group">
          <label class="form-label">描述</label>
          <textarea class="textarea" id="batch-desc" placeholder="队列描述" maxlength="2000" rows="2"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">所属工作区 *</label>
          <select class="select" id="batch-workspace">
            <option value="">加载中...</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">工作流 *</label>
          <select class="select" id="batch-workflow" disabled>
            <option value="">请先选择工作区</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="batch-stop-on-error" checked>
            <span>遇到错误时停止</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-label">任务列表</label>
          <div id="batch-items-list">
            ${_batchItems.map((item, idx) => renderBatchItemInput(idx, item.input)).join('')}
          </div>
          <button class="btn btn-sm btn-ghost" id="add-batch-item-btn" style="margin-top:8px;">+ 添加任务</button>
        </div>
      </div>
    `;
    }
    function renderBatchItemInput(idx, value) {
        return `
      <div class="batch-item-input" data-idx="${idx}" style="display:flex;gap:8px;margin-bottom:8px;align-items:flex-start;">
        <span style="color:var(--text-muted);font-family:var(--font-mono);font-size:11px;padding-top:8px;width:20px;text-align:right;">#${idx + 1}</span>
        <textarea class="textarea batch-item-text" data-idx="${idx}" placeholder="输入任务提示词..." rows="2" style="flex:1;min-height:40px;">${escapeHtml(value)}</textarea>
        <button class="btn btn-sm btn-ghost remove-batch-item-btn" data-idx="${idx}" title="移除" style="margin-top:4px;color:var(--accent-red);">${Icon.svg('close', 14)}</button>
      </div>
    `;
    }
    function bindEvents(agents, onSubmit) {
        // Batch mode toggle
        document.getElementById('batch-mode-toggle')?.addEventListener('change', (e) => {
            _isBatchMode = e.target.checked;
            const singleForm = document.getElementById('single-task-form');
            const batchForm = document.getElementById('batch-task-form');
            const submitBtn = document.getElementById('task-submit-btn');
            if (singleForm)
                singleForm.style.display = _isBatchMode ? 'none' : 'block';
            if (batchForm)
                batchForm.style.display = _isBatchMode ? 'block' : 'none';
            if (submitBtn)
                submitBtn.textContent = _isBatchMode ? '创建队列' : '创建任务';
        });
        // Load workspace list for both single and batch forms
        loadWorkspaceOptions('task-workspace');
        loadWorkspaceOptions('batch-workspace');
        // Workspace change → load workflows for that workspace
        bindWorkspaceChange('task-workspace', 'task-workflow');
        bindWorkspaceChange('batch-workspace', 'batch-workflow');
        // Workflow change: show folder path hint (single form only)
        const workflowSelect = document.getElementById('task-workflow');
        if (workflowSelect) {
            workflowSelect.addEventListener('change', () => {
                const selected = workflowSelect.options[workflowSelect.selectedIndex];
                const folderPath = selected?.dataset?.folder || '';
                const hintEl = document.getElementById('task-folder-hint');
                if (hintEl) {
                    hintEl.textContent = folderPath ? `工作流默认文件夹: ${folderPath}` : '';
                }
            });
        }
        // Browse folder button — default to workspace folder
        document.getElementById('task-browse-folder')?.addEventListener('click', () => {
            const wsSelect = document.getElementById('task-workspace');
            const selectedWs = wsSelect?.options[wsSelect.selectedIndex];
            const wsPath = selectedWs?.dataset?.path || '';
            DirectoryBrowser.open({
                title: '选择工作文件夹',
                onConfirm: (folderPath) => {
                    const input = document.getElementById('task-folder-path');
                    if (input)
                        input.value = folderPath;
                }
            });
        });
        // Batch item management
        bindBatchItemEvents();
        document.getElementById('add-batch-item-btn')?.addEventListener('click', () => {
            syncBatchItemValues();
            _batchItems.push({ input: '' });
            refreshBatchItems();
        });
        // Submit
        document.getElementById('task-submit-btn')?.addEventListener('click', () => {
            if (_isBatchMode) {
                handleSubmitBatch(onSubmit);
            }
            else {
                handleSubmitSingle(onSubmit);
            }
        });
    }
    async function loadWorkspaceOptions(selectId) {
        const wsSelect = document.getElementById(selectId);
        if (!wsSelect)
            return;
        try {
            const [activeRes, infoRes] = await Promise.allSettled([
                API.getWorkspaces(),
                API.getWorkspaceInfo()
            ]);
            const activeList = activeRes.status === 'fulfilled' ? (activeRes.value?.data || []) : [];
            const currentPath = infoRes.status === 'fulfilled' ? (infoRes.value?.data?.path || '') : '';
            wsSelect.innerHTML = activeList.map((ws) => `<option value="${ws.id}" data-path="${escapeHtml(ws.path)}" ${ws.path === currentPath ? 'selected' : ''}>${escapeHtml(ws.name || ws.path.split(/[/\\]/).pop())}</option>`).join('');
            // Auto-trigger workspace change to load workflows for the selected workspace
            wsSelect.dispatchEvent(new Event('change'));
        }
        catch (e) {
            wsSelect.innerHTML = '<option value="">加载失败</option>';
        }
    }
    function bindWorkspaceChange(wsSelectId, wfSelectId) {
        const wsSelect = document.getElementById(wsSelectId);
        if (!wsSelect)
            return;
        wsSelect.addEventListener('change', async () => {
            const wsId = wsSelect.value;
            const wfSelect = document.getElementById(wfSelectId);
            if (!wfSelect)
                return;
            if (!wsId) {
                wfSelect.innerHTML = '<option value="">请先选择工作区</option>';
                wfSelect.disabled = true;
                return;
            }
            // Load workflows for this workspace using dedicated API (no workspace switch needed)
            wfSelect.innerHTML = '<option value="">加载中...</option>';
            wfSelect.disabled = true;
            try {
                if (!_cachedWorkflows[wsId]) {
                    const wfRes = await API.getWorkspaceWorkflows(wsId);
                    _cachedWorkflows[wsId] = Array.isArray(wfRes.data) ? wfRes.data : (wfRes.data?.items || []);
                }
                const wfs = _cachedWorkflows[wsId];
                wfSelect.innerHTML = '<option value="">无</option>' +
                    wfs.map((w) => `<option value="${w.id}" data-folder="${w.folderPath || ''}" data-ws-id="${w.workspaceId || ''}">${escapeHtml(w.name)}</option>`).join('');
                wfSelect.disabled = false;
            }
            catch (e) {
                wfSelect.innerHTML = '<option value="">加载失败</option>';
                wfSelect.disabled = true;
            }
        });
    }
    function bindBatchItemEvents() {
        document.querySelectorAll('.batch-item-text').forEach(el => {
            el.addEventListener('input', (e) => {
                const target = e.target;
                const idx = parseInt(target.dataset.idx || '0');
                if (_batchItems[idx])
                    _batchItems[idx].input = target.value;
            });
        });
        document.querySelectorAll('.remove-batch-item-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                const target = e.target;
                const idx = parseInt(target.dataset.idx || '0');
                if (_batchItems.length <= 1) {
                    Toast.warning('至少需要一个任务');
                    return;
                }
                syncBatchItemValues();
                _batchItems.splice(idx, 1);
                refreshBatchItems();
            });
        });
    }
    function syncBatchItemValues() {
        document.querySelectorAll('.batch-item-text').forEach(el => {
            const idx = parseInt(el.dataset.idx || '0');
            if (_batchItems[idx])
                _batchItems[idx].input = el.value;
        });
    }
    function refreshBatchItems() {
        const list = document.getElementById('batch-items-list');
        if (!list)
            return;
        list.innerHTML = _batchItems.map((item, idx) => renderBatchItemInput(idx, item.input)).join('');
        bindBatchItemEvents();
    }
    function handleSubmitSingle(onSubmit) {
        const wsId = document.getElementById('task-workspace')?.value || '';
        const data = {
            title: document.getElementById('task-title')?.value.trim(),
            description: document.getElementById('task-desc')?.value.trim(),
            priority: document.getElementById('task-priority')?.value,
            assignedAgentId: document.getElementById('task-agent')?.value || undefined,
            workflowId: document.getElementById('task-workflow')?.value || undefined,
            workspaceId: wsId || undefined,
            folderPath: document.getElementById('task-folder-path')?.value.trim() || undefined,
            input: document.getElementById('task-input')?.value.trim(),
            autoExecute: document.getElementById('task-auto-execute')?.checked || false,
        };
        if (!data.title) {
            Toast.warning('标题为必填项');
            return;
        }
        if (!data.workspaceId) {
            Toast.warning('请选择工作区');
            return;
        }
        if (!data.assignedAgentId && !data.workflowId) {
            Toast.warning('请至少选择一个执行Agent或工作流');
            return;
        }
        onSubmit(data, false);
    }
    function handleSubmitBatch(onSubmit) {
        syncBatchItemValues();
        const name = document.getElementById('batch-name')?.value.trim();
        const description = document.getElementById('batch-desc')?.value.trim();
        const wsId = document.getElementById('batch-workspace')?.value;
        const workflowId = document.getElementById('batch-workflow')?.value;
        const stopOnError = document.getElementById('batch-stop-on-error')?.checked;
        if (!name) {
            Toast.warning('队列名称为必填项');
            return;
        }
        if (!wsId) {
            Toast.warning('请选择工作区');
            return;
        }
        if (!workflowId) {
            Toast.warning('请选择工作流');
            return;
        }
        const validItems = _batchItems.filter(i => i.input.trim());
        if (validItems.length === 0) {
            Toast.warning('至少需要一个有效任务');
            return;
        }
        onSubmit({
            name,
            description,
            workspaceId: wsId,
            workflowId,
            stopOnError,
            items: validItems,
        }, true);
    }
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
    function openWithWorkflow(workflowId, workflowName) {
        // This function is called from WorkflowsPage
        // It should not be used directly - instead, navigate to TasksPage
        // and let the user create a task there with the workflow pre-selected
        console.warn('openWithWorkflow called - this should be handled by TasksPage');
    }
    return { open, openWithWorkflow };
})();
