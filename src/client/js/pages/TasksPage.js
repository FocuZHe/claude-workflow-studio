"use strict";
window.TasksPage = (() => {
    let tasks = [];
    let queues = [];
    let agents = [];
    let workflows = [];
    let filterStatus = '';
    let filterPriority = '';
    let filterType = ''; // '', 'task', 'queue'
    let _wsUnsubs = [];
    let _searchTimer = null;
    let _selectionMode = false;
    let _selectedIds = new Set();
    const PAGE_SIZE = 20;
    // Track last shown Toast status per task to prevent duplicate popups
    const _taskStatusToasts = new Map();
    let _currentPage = 1;
    let _totalItems = 0;
    let _loadingMore = false;
    const QUEUE_STATUS_LABELS = {
        pending: '等待中',
        running: '执行中',
        paused: '已暂停',
        completed: '已完成',
        failed: '失败',
        cancelled: '已取消',
        waiting_human: '等待人工',
    };
    async function render() {
        const el = document.getElementById('content');
        el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">${Icon.svg('tasks', 20)}</span> 任务</h1>
          <div class="page-actions">
            <button class="btn btn-secondary" id="batch-select-btn">批量选择</button>
            <button class="btn btn-primary" id="create-task-btn">+ 新建任务</button>
          </div>
        </div>
        <div class="toolbar">
          <div class="search-input">
            <span class="search-icon">${Icon.svg('search', 16)}</span>
            <input class="input" id="task-search" placeholder="搜索任务..." style="width:220px;">
          </div>
          <div class="toolbar-separator"></div>
          <select class="select" id="filter-task-type" style="width:120px;">
            <option value="">全部类型</option>
            <option value="task">单个任务</option>
            <option value="queue">任务队列</option>
          </select>
          <select class="select select-md" id="filter-task-status">
            <option value="">全部状态</option>
            <option value="pending">等待中</option>
            <option value="running">运行中</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
            <option value="cancelled">已取消</option>
            <option value="paused">已暂停</option>
          </select>
          <select class="select select-md" id="filter-task-priority">
            <option value="">全部优先级</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
            <option value="urgent">紧急</option>
          </select>
        </div>
        <div id="interrupted-workflows"></div>
        <div id="tasks-list"></div>
      </div>
    `;
        document.getElementById('create-task-btn').addEventListener('click', openCreateModal);
        document.getElementById('batch-select-btn').addEventListener('click', toggleSelectionMode);
        document.getElementById('task-search').addEventListener('input', (e) => {
            if (e.isComposing)
                return;
            if (_searchTimer)
                clearTimeout(_searchTimer);
            _searchTimer = setTimeout(() => { tasks = []; _currentPage = 1; _totalItems = 0; loadTasks(1); }, 300);
        });
        document.getElementById('task-search').addEventListener('compositionend', (_e) => {
            if (_searchTimer)
                clearTimeout(_searchTimer);
            _searchTimer = setTimeout(() => { tasks = []; _currentPage = 1; _totalItems = 0; loadTasks(1); }, 300);
        });
        document.getElementById('filter-task-type').addEventListener('change', (e) => {
            filterType = e.target.value;
            tasks = [];
            _currentPage = 1;
            _totalItems = 0;
            loadTasks(1);
        });
        document.getElementById('filter-task-status').addEventListener('change', (e) => {
            filterStatus = e.target.value;
            tasks = [];
            _currentPage = 1;
            _totalItems = 0;
            loadTasks(1);
        });
        document.getElementById('filter-task-priority').addEventListener('change', (e) => {
            filterPriority = e.target.value;
            tasks = [];
            _currentPage = 1;
            _totalItems = 0;
            loadTasks(1);
        });
        // Clean up previous listeners
        _wsUnsubs.forEach((fn) => fn());
        _wsUnsubs = [];
        _taskStatusToasts.clear();
        // Task events
        _wsUnsubs.push(WS.on('task.created', () => loadTasks()));
        _wsUnsubs.push(WS.on('task.updated', () => loadTasks()));
        _wsUnsubs.push(WS.on('task.deleted', () => loadTasks()));
        _wsUnsubs.push(WS.on('task.progress', onTaskProgress));
        _wsUnsubs.push(WS.on('task.completed', onTaskCompleted));
        _wsUnsubs.push(WS.on('task.failed', onTaskFailed));
        // Queue events
        _wsUnsubs.push(WS.on('queue.started', onQueueUpdate));
        _wsUnsubs.push(WS.on('queue.itemStarted', onQueueUpdate));
        _wsUnsubs.push(WS.on('queue.itemCompleted', onQueueUpdate));
        _wsUnsubs.push(WS.on('queue.itemFailed', onQueueUpdate));
        _wsUnsubs.push(WS.on('queue.paused', onQueueUpdate));
        _wsUnsubs.push(WS.on('queue.resumed', onQueueUpdate));
        _wsUnsubs.push(WS.on('queue.completed', onQueueUpdate));
        _wsUnsubs.push(WS.on('queue.failed', onQueueUpdate));
        _wsUnsubs.push(WS.on('queue.cancelled', onQueueUpdate));
        _wsUnsubs.push(WS.on('queue.waitingHuman', onQueueUpdate));
        _wsUnsubs.push(WS.on('queue.progress', onQueueUpdate));
        // Listen for WebSocket reconnection to refresh data (remove first to prevent duplicates)
        window.removeEventListener('ws:reconnected', _onReconnect);
        window.addEventListener('ws:reconnected', _onReconnect);
        await Promise.all([loadTasks(), loadQueues(), loadAgents(), loadWorkflows()]);
        await loadWorkspacesAndNames();
        renderList();
    }
    async function loadTasks(page) {
        if (page === undefined)
            page = 1;
        if (_loadingMore)
            return;
        _loadingMore = true;
        try {
            const params = { page, limit: PAGE_SIZE };
            if (filterStatus)
                params.status = filterStatus;
            if (filterPriority)
                params.priority = filterPriority;
            const res = await API.getTasks(params);
            const d = res.data;
            const items = Array.isArray(d) ? d : (d?.items || []);
            const meta = res.meta || {};
            if (page === 1) {
                tasks = items;
            }
            else {
                tasks = [...tasks, ...items];
            }
            _currentPage = meta.page || page;
            _totalItems = meta.total || tasks.length;
            // 每次加载任务后刷新名称缓存
            await loadWorkspacesAndNames();
            renderList();
        }
        catch (e) {
            Toast.error('加载任务失败');
        }
        finally {
            _loadingMore = false;
        }
    }
    async function loadQueues() {
        try {
            const res = await API.getTaskQueues();
            const d = res.data;
            queues = Array.isArray(d) ? d : (d?.items || []);
        }
        catch (e) {
            Toast.error('加载队列失败');
        }
    }
    async function loadAgents() {
        try {
            const res = await API.getAgents();
            const d = res.data;
            agents = Array.isArray(d) ? d : (d?.items || []);
        }
        catch (e) {
            Toast.error('加载Agent列表失败');
        }
    }
    async function loadWorkflows() {
        try {
            const res = await API.getWorkflows({ limit: 10000 });
            const d = res.data;
            workflows = Array.isArray(d) ? d : (d?.items || []);
        }
        catch (e) {
            Toast.error('加载工作流列表失败');
        }
    }
    function getInterruptedWorkflows() {
        return workflows.filter(wf => wf.executionStatus === 'interrupted' || wf.executionStatus === 'failed');
    }
    function renderInterruptedWorkflows() {
        const interrupted = getInterruptedWorkflows();
        if (interrupted.length === 0)
            return '';
        return `
      <div style="margin-bottom:16px;padding:12px;background:rgba(255,170,0,0.08);border:1px solid rgba(255,170,0,0.2);border-radius:var(--border-radius);">
        <div style="font-size:13px;font-weight:600;color:var(--accent-amber);margin-bottom:8px;">
          ⚠️ 中断的工作流 (${interrupted.length})
        </div>
        <div style="display:grid;gap:8px;">
          ${interrupted.map(wf => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;background:var(--bg-secondary);border-radius:4px;">
              <div>
                <div style="font-weight:600;font-size:13px;">${escapeHtml(wf.name)}</div>
                <div style="font-size:11px;color:var(--text-muted);">状态: ${wf.executionStatus}</div>
              </div>
              <button class="btn btn-sm btn-primary resume-workflow-btn" data-id="${wf.id}">恢复执行</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    }
    async function loadWorkspacesAndNames() {
        try {
            const res = await API.getWorkspaces();
            const workspaces = res.data || [];
            await TaskCard.loadNames(workflows, workspaces);
        }
        catch (e) { /* ignore */ }
    }
    function getFiltered() {
        const search = (document.getElementById('task-search')?.value || '').toLowerCase();
        // Build unified list: tasks (server-paginated) and queues (all loaded)
        let items = [];
        if (filterType !== 'queue') {
            tasks.forEach((t) => items.push({ ...t, _type: 'task' }));
        }
        if (filterType !== 'task') {
            queues.forEach((q) => {
                // Apply status filter to queues client-side
                if (filterStatus && q.status !== filterStatus)
                    return;
                items.push({ ...q, _type: 'queue' });
            });
        }
        // Search filter is client-side
        if (!search)
            return items;
        return items.filter((t) => {
            const title = (t.title || t.name || '').toLowerCase();
            return title.includes(search);
        });
    }
    function renderList() {
        const container = document.getElementById('tasks-list');
        if (!container)
            return;
        // Render interrupted workflows section
        const interruptedEl = document.getElementById('interrupted-workflows');
        if (interruptedEl) {
            interruptedEl.innerHTML = renderInterruptedWorkflows();
            // Bind resume workflow buttons
            interruptedEl.querySelectorAll('.resume-workflow-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const wfId = btn.dataset.id;
                    try {
                        const res = await API.resumeWorkflowFromCheckpoint(wfId);
                        Toast.success('工作流已从检查点恢复');
                        await loadWorkflows();
                        renderList();
                    }
                    catch (err) {
                        Toast.error('恢复失败: ' + err.message);
                    }
                });
            });
        }
        const filtered = getFiltered();
        if (filtered.length === 0 && _currentPage <= 1) {
            container.innerHTML = EmptyState.render({
                icon: `${Icon.svg('check', 16)}`,
                title: '还没有任务',
                description: '创建任务来让 Agent 帮你完成工作',
                actionText: '+ 创建任务',
                actionId: 'empty-create-task-btn'
            });
            document.getElementById('empty-create-task-btn')?.addEventListener('click', openCreateModal);
            const paginationEl = document.getElementById('tasks-pagination');
            if (paginationEl)
                paginationEl.innerHTML = '';
            return;
        }
        container.innerHTML = `<div class="stagger">${filtered.map((item) => {
            if (_selectionMode) {
                const isChecked = _selectedIds.has(item.id);
                const checkboxHtml = `<div style="position:absolute;top:12px;left:12px;z-index:10;"><input type="checkbox" class="batch-checkbox" data-id="${item.id}" ${isChecked ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent-cyan);"></div>`;
                if (item._type === 'queue') {
                    return `<div style="position:relative;">${checkboxHtml}${renderQueueCard(item)}</div>`;
                }
                return `<div style="position:relative;">${checkboxHtml}${TaskCard.render(item, agents)}</div>`;
            }
            if (item._type === 'queue')
                return renderQueueCard(item);
            return TaskCard.render(item, agents);
        }).join('')}</div>${filterType !== 'queue' ? renderLoadMoreButton(tasks.length, _totalItems, 'load-more-tasks') : ''}`;
        // Bind task card events
        container.querySelectorAll('.task-card').forEach((card) => {
            const id = card.dataset.id;
            card.querySelector('.btn-execute')?.addEventListener('click', (e) => { e.stopPropagation(); executeTask(id); });
            card.querySelector('.btn-pause')?.addEventListener('click', (e) => { e.stopPropagation(); pauseTask(id); });
            card.querySelector('.btn-resume')?.addEventListener('click', (e) => { e.stopPropagation(); resumeTask(id); });
            card.querySelector('.btn-cancel')?.addEventListener('click', (e) => { e.stopPropagation(); cancelTask(id); });
            card.querySelector('.btn-delete')?.addEventListener('click', (e) => { e.stopPropagation(); deleteTask(id); });
            card.addEventListener('click', () => openDetailModal(id));
        });
        // Bind queue card events
        container.querySelectorAll('.queue-card').forEach((card) => {
            const id = card.dataset.id;
            card.querySelector('.btn-start')?.addEventListener('click', (e) => { e.stopPropagation(); startQueue(id); });
            card.querySelector('.btn-pause')?.addEventListener('click', (e) => { e.stopPropagation(); pauseQueue(id); });
            card.querySelector('.btn-resume')?.addEventListener('click', (e) => { e.stopPropagation(); resumeQueue(id); });
            card.querySelector('.btn-cancel')?.addEventListener('click', (e) => { e.stopPropagation(); cancelQueue(id); });
            card.querySelector('.btn-delete')?.addEventListener('click', (e) => { e.stopPropagation(); deleteQueue(id); });
            card.addEventListener('click', () => openQueueDetail(id));
        });
        // Batch checkbox events
        container.querySelectorAll('.batch-checkbox').forEach((cb) => {
            cb.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSelectItem(cb.dataset.id);
            });
        });
        // Bind load more
        bindLoadMoreButton('load-more-tasks', () => loadTasks(_currentPage + 1));
        // Update pagination info
        renderTaskPaginationInfo();
    }
    // ── Queue Card Rendering ──────────────────────────────────────
    function renderQueueCard(queue) {
        const wf = workflows.find((w) => w.id === queue.workflowId);
        const items = queue.items || [];
        const total = items.length;
        const completed = items.filter((i) => i.status === 'completed').length;
        const failed = items.filter((i) => i.status === 'failed').length;
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        const timeAgo = getTimeAgo(queue.createdAt);
        const progressColor = queue.status === 'failed' ? 'var(--accent-red)' :
            queue.status === 'completed' ? 'var(--accent-green)' : 'var(--accent-cyan)';
        const itemPreview = items.slice(0, 3).map((item, idx) => {
            const isRunning = item.status === 'running';
            const isWaiting = item.status === 'waiting_human';
            return `
        <div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11px;">
          <span style="color:var(--text-muted);font-family:var(--font-mono);width:20px;text-align:right;">#${idx + 1}</span>
          ${isRunning ? '<span class="spinner spinner-sm"></span>' : ''}
          ${isWaiting ? `<span style="color:var(--accent-purple);animation:pulse 1.5s infinite;">${Icon.svg('spinner', 14)}</span>` : ''}
          <span style="flex:1;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeAttr(item.input || '')}">${escapeHtml(truncate(item.input || '', 50))}</span>
          <span class="badge badge-${item.status}" style="font-size:9px;padding:1px 6px;">${QUEUE_STATUS_LABELS[item.status] || item.status}</span>
        </div>
      `;
        }).join('');
        const remaining = total - 3;
        const moreHtml = remaining > 0 ? `<div style="font-size:11px;color:var(--text-muted);padding:2px 0;">... 还有 ${remaining} 项</div>` : '';
        return `
      <div class="card queue-card hover-lift" data-id="${queue.id}" style="margin-bottom:8px;cursor:pointer;border-left:3px solid var(--accent-purple);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
            <div style="min-width:0;flex:1;">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                <span style="font-size:11px;color:var(--accent-purple);background:rgba(156,106,255,0.1);padding:1px 6px;border-radius:4px;font-weight:600;">队列</span>
                <span class="card-title" style="font-size:14px;" title="${escapeAttr(queue.name)}">${escapeHtml(queue.name)}</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;font-size:11px;">
                ${StatusBadge.render(queue.status)}
                ${queue.status === 'running' ? '<span class="running-indicator"></span>' : ''}
                ${queue.workflowId && !wf ? '<span class="badge badge-error">工作流不存在</span>' : ''}
                ${wf ? `<span style="color:var(--accent-cyan);padding:1px 4px;background:rgba(0,200,255,0.08);border-radius:3px;">${escapeHtml(wf.name)}</span>` : ''}
                <span style="color:var(--text-muted);font-family:var(--font-mono);">${timeAgo}</span>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:4px;margin-left:12px;">
            ${queue.status === 'pending' || queue.status === 'paused' ? `<button class="btn btn-sm btn-success btn-start" title="开始">${Icon.svg('play', 14)}</button>` : ''}
            ${queue.status === 'running' ? `<button class="btn btn-sm btn-secondary btn-pause" title="暂停">${Icon.svg('pause', 14)}</button>` : ''}
            ${queue.status === 'paused' ? `<button class="btn btn-sm btn-secondary btn-resume" title="继续">${Icon.svg('play', 14)}</button>` : ''}
            ${queue.status === 'running' || queue.status === 'paused' ? `<button class="btn btn-sm btn-danger btn-cancel" title="取消">${Icon.svg('stop', 14)}</button>` : ''}
            ${queue.status !== 'running' ? `<button class="btn btn-sm btn-danger btn-delete" title="删除">${Icon.svg('close', 14)}</button>` : ''}
          </div>
        </div>
        <div style="margin-bottom:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:11px;color:var(--text-muted);">进度</span>
            <span style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);">${completed}/${total} (${percent}%)${failed > 0 ? ` <span style="color:var(--accent-red);">${failed} 失败</span>` : ''}</span>
          </div>
          <div class="progress-bar" style="width:100%;">
            <div class="progress-bar-fill" style="width:${percent}%;background:${progressColor};"></div>
          </div>
        </div>
      </div>
    `;
    }
    // ── Pagination Info ────────────────────────────────────────────
    function renderTaskPaginationInfo() {
        let paginationEl = document.getElementById('tasks-pagination');
        if (!paginationEl) {
            const container = document.getElementById('tasks-list');
            if (!container)
                return;
            paginationEl = document.createElement('div');
            paginationEl.id = 'tasks-pagination';
            paginationEl.className = 'pagination-info';
            container.parentNode.insertBefore(paginationEl, container.nextSibling);
        }
        if (filterType === 'queue') {
            paginationEl.innerHTML = '';
        }
        else {
            paginationEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">已加载 ${tasks.length} / ${_totalItems} 条</span>`;
        }
    }
    // ── WebSocket Handlers ────────────────────────────────────────
    const _throttledRenderList = throttle(() => renderList(), 500);
    function onTaskProgress(payload) {
        const idx = tasks.findIndex((t) => t.id === payload.taskId);
        if (idx >= 0) {
            const prevStatus = tasks[idx].status;
            tasks[idx].status = payload.status;
            if (payload.status !== prevStatus) {
                _taskStatusToasts.set(payload.taskId, payload.status);
                if (payload.message) {
                    Toast.show(`[${payload.taskName || '任务'}] ${payload.message}`, 'info', 3000);
                }
                // Update card in-place without full re-render
                TaskCard.updateCardStatus(payload.taskId, payload.status);
            }
        }
    }
    function onTaskCompleted(payload) {
        const idx = tasks.findIndex((t) => t.id === payload.taskId);
        if (idx >= 0) {
            tasks[idx].status = 'completed';
            tasks[idx].output = payload.output;
            TaskCard.updateCardStatus(payload.taskId, 'completed');
        }
    }
    function onTaskFailed(payload) {
        const idx = tasks.findIndex((t) => t.id === payload.taskId);
        if (idx >= 0) {
            tasks[idx].status = 'failed';
            tasks[idx].error = payload.error || payload.message || '执行失败';
            TaskCard.updateCardStatus(payload.taskId, 'failed');
        }
    }
    function onQueueUpdate() {
        loadQueues().then(() => _throttledRenderList());
    }
    // ── Task Actions ──────────────────────────────────────────────
    function openCreateModal() {
        TaskCreate.open(agents, workflows, async (data, isBatch) => {
            if (isBatch) {
                // Batch mode: create queue
                const btn = document.querySelector('.modal .btn-primary');
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = '创建中...';
                }
                try {
                    await API.createTaskQueue(data);
                    Toast.success('队列已创建');
                    Modal.close();
                    await loadQueues();
                    renderList();
                }
                catch (e) {
                    Toast.error(e.message);
                }
                finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = '创建任务';
                    }
                }
            }
            else {
                // Single mode: create task
                const btn = document.querySelector('.modal .btn-primary');
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = '创建中...';
                }
                try {
                    const autoExecute = data.autoExecute;
                    delete data.autoExecute;
                    const res = await API.createTask(data);
                    Toast.success('任务已创建');
                    Modal.close();
                    await loadTasks();
                    renderList();
                    if (autoExecute && res.data?.id) {
                        await executeTask(res.data.id);
                    }
                }
                catch (e) {
                    Toast.error(e.message);
                }
                finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = '创建任务';
                    }
                }
            }
        });
    }
    async function openDetailModal(id) {
        try {
            const res = await API.getTask(id);
            TaskDetail.open(res.data, agents);
        }
        catch (e) {
            Toast.error('加载任务失败');
        }
    }
    async function executeTask(id) {
        const card = document.querySelector(`.task-card[data-id="${id}"]`);
        const btn = card?.querySelector('.btn-execute');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '...';
        }
        try {
            await API.executeTask(id);
            Toast.success('任务已开始执行');
            await loadTasks();
            renderList();
        }
        catch (e) {
            Toast.error(e.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = Icon.svg('play', 14);
            }
        }
    }
    async function pauseTask(id) {
        const card = document.querySelector(`.task-card[data-id="${id}"]`);
        const btn = card?.querySelector('.btn-pause');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '...';
        }
        try {
            await API.pauseTask(id);
            Toast.success('任务已暂停');
            await loadTasks();
            renderList();
        }
        catch (e) {
            Toast.error(e.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = Icon.svg('pause', 14);
            }
        }
    }
    async function resumeTask(id) {
        const card = document.querySelector(`.task-card[data-id="${id}"]`);
        const btn = card?.querySelector('.btn-resume');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '...';
        }
        try {
            await API.resumeTask(id);
            Toast.success('任务已继续');
            await loadTasks();
            renderList();
        }
        catch (e) {
            Toast.error(e.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = Icon.svg('play', 14);
            }
        }
    }
    async function cancelTask(id) {
        const card = document.querySelector(`.task-card[data-id="${id}"]`);
        const btn = card?.querySelector('.btn-cancel');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '...';
        }
        try {
            await API.cancelTask(id);
            Toast.success('任务已取消');
            await loadTasks();
            renderList();
        }
        catch (e) {
            Toast.error(e.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = Icon.svg('stop', 14);
            }
        }
    }
    async function deleteTask(id) {
        if (!await Modal.confirm('删除任务', '确定删除此任务？'))
            return;
        const card = document.querySelector(`.task-card[data-id="${id}"]`);
        const btn = card?.querySelector('.btn-delete');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '...';
        }
        try {
            await API.deleteTask(id);
            Toast.success('任务已删除');
            await loadTasks();
            renderList();
        }
        catch (e) {
            Toast.error(e.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = Icon.svg('close', 14);
            }
        }
    }
    // ── Queue Actions ─────────────────────────────────────────────
    async function openQueueDetail(queueId) {
        TaskQueueDetail.open(queueId);
    }
    async function startQueue(id) {
        const card = document.querySelector(`.queue-card[data-id="${id}"]`);
        const btn = card?.querySelector('.btn-start');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '...';
        }
        try {
            await API.startTaskQueue(id);
            Toast.success('队列已开始');
            await loadQueues();
            renderList();
        }
        catch (e) {
            Toast.error(e.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = Icon.svg('play', 14);
            }
        }
    }
    async function pauseQueue(id) {
        const card = document.querySelector(`.queue-card[data-id="${id}"]`);
        const btn = card?.querySelector('.btn-pause');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '...';
        }
        try {
            await API.pauseTaskQueue(id);
            Toast.success('队列已暂停');
            await loadQueues();
            renderList();
        }
        catch (e) {
            Toast.error(e.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = Icon.svg('pause', 14);
            }
        }
    }
    async function resumeQueue(id) {
        const card = document.querySelector(`.queue-card[data-id="${id}"]`);
        const btn = card?.querySelector('.btn-resume');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '...';
        }
        try {
            await API.resumeTaskQueue(id);
            Toast.success('队列已继续');
            await loadQueues();
            renderList();
        }
        catch (e) {
            Toast.error(e.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = Icon.svg('play', 14);
            }
        }
    }
    async function cancelQueue(id) {
        if (!await Modal.confirm('取消队列', '确定取消此队列？正在执行的任务将被中断。'))
            return;
        const card = document.querySelector(`.queue-card[data-id="${id}"]`);
        const btn = card?.querySelector('.btn-cancel');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '...';
        }
        try {
            await API.cancelTaskQueue(id);
            Toast.success('队列已取消');
            await loadQueues();
            renderList();
        }
        catch (e) {
            Toast.error(e.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = Icon.svg('stop', 14);
            }
        }
    }
    async function deleteQueue(id) {
        if (!await Modal.confirm('删除队列', '确定删除此队列？此操作不可撤销。'))
            return;
        const card = document.querySelector(`.queue-card[data-id="${id}"]`);
        const btn = card?.querySelector('.btn-delete');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '...';
        }
        try {
            await API.deleteTaskQueue(id);
            Toast.success('队列已删除');
            await loadQueues();
            renderList();
        }
        catch (e) {
            Toast.error(e.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = Icon.svg('close', 14);
            }
        }
    }
    // ── Batch Selection ──────────────────────────────────────────
    function toggleSelectionMode() {
        _selectionMode = !_selectionMode;
        if (!_selectionMode) {
            _selectedIds.clear();
            removeBatchActionBar();
        }
        else {
            showBatchActionBar();
        }
        renderList();
    }
    function toggleSelectItem(id) {
        if (_selectedIds.has(id)) {
            _selectedIds.delete(id);
        }
        else {
            _selectedIds.add(id);
        }
        updateBatchActionBar();
        updateCheckboxes();
    }
    function updateCheckboxes() {
        document.querySelectorAll('.batch-checkbox').forEach((cb) => {
            cb.checked = _selectedIds.has(cb.dataset.id);
        });
        const selectAllCb = document.getElementById('batch-select-all');
        if (selectAllCb) {
            const allCbs = document.querySelectorAll('.batch-checkbox');
            selectAllCb.checked = allCbs.length > 0 && _selectedIds.size >= allCbs.length;
        }
    }
    function showBatchActionBar() {
        removeBatchActionBar();
        const bar = document.createElement('div');
        bar.id = 'batch-action-bar';
        bar.className = 'batch-action-bar';
        bar.innerHTML = `
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;color:var(--text-secondary);">
        <input type="checkbox" id="batch-select-all" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent-cyan);"> 全选
      </label>
      <span style="font-size:13px;color:var(--text-secondary);">已选择 <strong id="batch-count" style="color:var(--accent-cyan);">${_selectedIds.size}</strong> 项</span>
      <button class="btn btn-sm btn-danger" id="batch-delete-btn">批量删除</button>
      <button class="btn btn-sm btn-secondary" id="batch-cancel-btn">取消选择</button>
    `;
        document.body.appendChild(bar);
        document.getElementById('batch-delete-btn').addEventListener('click', batchDelete);
        document.getElementById('batch-cancel-btn').addEventListener('click', () => { _selectionMode = false; _selectedIds.clear(); removeBatchActionBar(); renderList(); });
        document.getElementById('batch-select-all')?.addEventListener('change', (e) => {
            const allCbs = document.querySelectorAll('.batch-checkbox');
            allCbs.forEach((cb) => { cb.checked = e.target.checked; });
            if (e.target.checked) {
                getFiltered().forEach((t) => _selectedIds.add(t.id));
            }
            else {
                _selectedIds.clear();
            }
            updateBatchActionBar();
        });
    }
    function removeBatchActionBar() {
        document.getElementById('batch-action-bar')?.remove();
    }
    function updateBatchActionBar() {
        const countEl = document.getElementById('batch-count');
        if (countEl) {
            countEl.textContent = String(_selectedIds.size);
        }
        if (_selectedIds.size > 0 && !document.getElementById('batch-action-bar')) {
            showBatchActionBar();
        }
        else if (_selectedIds.size === 0) {
            removeBatchActionBar();
        }
    }
    async function batchDelete() {
        if (_selectedIds.size === 0)
            return;
        if (!await Modal.confirm('批量删除', `确定删除选中的 ${_selectedIds.size} 个项目？此操作不可撤销。`))
            return;
        const ids = Array.from(_selectedIds);
        try {
            // Separate tasks and queues
            const taskIds = [];
            const queueIds = [];
            const filtered = getFiltered();
            ids.forEach((id) => {
                const item = filtered.find((t) => t.id === id);
                if (item && item._type === 'queue') {
                    queueIds.push(id);
                }
                else {
                    taskIds.push(id);
                }
            });
            const promises = [];
            if (taskIds.length > 0)
                promises.push(API.deleteTasksBatch(taskIds));
            if (queueIds.length > 0)
                promises.push(API.deleteTaskQueuesBatch(queueIds));
            await Promise.all(promises);
            Toast.success(`已删除 ${ids.length} 个项目`);
            _selectionMode = false;
            _selectedIds.clear();
            removeBatchActionBar();
            await Promise.all([loadTasks(), loadQueues()]);
            renderList();
        }
        catch (e) {
            Toast.error('批量删除失败: ' + e.message);
        }
    }
    // ── Utilities ─────────────────────────────────────────────────
    function getTimeAgo(dateStr) {
        if (!dateStr)
            return '';
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1)
            return '刚刚';
        if (mins < 60)
            return `${mins}分钟前`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24)
            return `${hrs}小时前`;
        return `${Math.floor(hrs / 24)}天前`;
    }
    function truncate(str, max) {
        if (!str)
            return '';
        return str.length > max ? str.slice(0, max) + '...' : str;
    }
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
    function escapeAttr(str) {
        return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function _onReconnect() {
        console.log('[TasksPage] WebSocket reconnected, refreshing data...');
        loadTasks();
        loadQueues();
    }
    function cleanup() {
        _wsUnsubs.forEach((fn) => fn());
        _wsUnsubs = [];
        window.removeEventListener('ws:reconnected', _onReconnect);
        _selectionMode = false;
        _selectedIds.clear();
        removeBatchActionBar();
    }
    return { render, cleanup };
})();
