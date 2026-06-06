"use strict";
window.TaskQueuePage = (() => {
    let queues = [];
    let workflows = [];
    let filterStatus = '';
    let filterWorkflow = '';
    let _wsUnsubs = [];
    let _storeUnsub = null;
    const PAGE_SIZE = 20;
    let currentPage = 1;
    const STATUS_LABELS = {
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
          <h1 class="page-title"><span class="page-icon">${Icon.svg('tasks', 20)}</span> 任务队列</h1>
          <button class="btn btn-primary" id="create-queue-btn">+ 创建队列</button>
        </div>
        <div class="toolbar">
          <select class="select" id="filter-queue-status" style="width:140px;">
            <option value="">全部状态</option>
            <option value="pending">等待中</option>
            <option value="running">执行中</option>
            <option value="paused">已暂停</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
            <option value="cancelled">已取消</option>
          </select>
          <div class="toolbar-separator"></div>
          <select class="select" id="filter-queue-workflow" style="width:180px;">
            <option value="">全部工作流</option>
          </select>
        </div>
        <div id="queues-list"></div>
      </div>
    `;
        document.getElementById('create-queue-btn').addEventListener('click', openCreateModal);
        document.getElementById('filter-queue-status').addEventListener('change', (e) => {
            filterStatus = e.target.value;
            currentPage = 1;
            renderList();
        });
        document.getElementById('filter-queue-workflow').addEventListener('change', (e) => {
            filterWorkflow = e.target.value;
            currentPage = 1;
            renderList();
        });
        // Clean up previous listeners
        _wsUnsubs.forEach((fn) => fn());
        _wsUnsubs = [];
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
        await Promise.all([loadQueues(), loadWorkflows()]);
        populateWorkflowFilter();
        renderList();
        // 监听工作流数据更新（重命名等）
        if (typeof Store !== 'undefined') {
            _storeUnsub = Store.subscribe('workflowsDirty', async () => {
                await loadWorkflows();
                populateWorkflowFilter();
                renderList();
            });
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
    async function loadWorkflows() {
        try {
            const res = await API.getWorkflows();
            const d = res.data;
            workflows = Array.isArray(d) ? d : (d?.items || []);
        }
        catch (e) {
            Toast.error('加载工作流列表失败');
        }
    }
    function populateWorkflowFilter() {
        const select = document.getElementById('filter-queue-workflow');
        if (!select)
            return;
        const current = select.value;
        select.innerHTML = '<option value="">全部工作流</option>' +
            workflows.map((w) => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
        select.value = current;
    }
    function getFiltered() {
        return queues.filter((q) => {
            if (filterStatus && q.status !== filterStatus)
                return false;
            if (filterWorkflow && q.workflowId !== filterWorkflow)
                return false;
            return true;
        });
    }
    function renderList() {
        const container = document.getElementById('queues-list');
        if (!container)
            return;
        const filtered = getFiltered();
        if (filtered.length === 0) {
            container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${Icon.svg('tasks', 48)}</div>
          <div class="empty-title">未找到队列</div>
          <div class="empty-desc">创建一个任务队列以开始使用</div>
        </div>
      `;
            const paginationEl = document.getElementById('queues-pagination');
            if (paginationEl)
                paginationEl.innerHTML = '';
            return;
        }
        // Pagination
        const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
        if (currentPage > totalPages)
            currentPage = totalPages;
        const start = (currentPage - 1) * PAGE_SIZE;
        const paged = filtered.slice(start, start + PAGE_SIZE);
        container.innerHTML = `<div class="stagger">${paged.map((q) => renderQueueCard(q)).join('')}</div>`;
        container.querySelectorAll('.queue-card').forEach((card) => {
            const id = card.dataset.id;
            card.querySelector('.btn-start')?.addEventListener('click', (e) => { e.stopPropagation(); startQueue(id); });
            card.querySelector('.btn-pause')?.addEventListener('click', (e) => { e.stopPropagation(); pauseQueue(id); });
            card.querySelector('.btn-resume')?.addEventListener('click', (e) => { e.stopPropagation(); resumeQueue(id); });
            card.querySelector('.btn-cancel')?.addEventListener('click', (e) => { e.stopPropagation(); cancelQueue(id); });
            card.querySelector('.btn-delete')?.addEventListener('click', (e) => { e.stopPropagation(); deleteQueue(id); });
            card.addEventListener('click', () => openDetail(id));
        });
        renderPagination(filtered.length, totalPages);
    }
    function renderQueueCard(queue) {
        const wf = workflows.find((w) => w.id === queue.workflowId);
        const items = queue.items || [];
        const total = items.length;
        const completed = items.filter((i) => i.status === 'completed').length;
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        const timeAgo = getTimeAgo(queue.createdAt);
        const itemPreview = items.slice(0, 5).map((item, idx) => {
            const isRunning = item.status === 'running';
            const isWaiting = item.status === 'waiting_human';
            return `
        <div class="queue-item-row" style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11px;">
          <span style="color:var(--text-muted);font-family:var(--font-mono);width:20px;text-align:right;">#${idx + 1}</span>
          ${isRunning ? '<span class="spinner spinner-sm"></span>' : ''}
          ${isWaiting ? '<span style="color:var(--accent-purple);animation:pulse 1.5s infinite;">⏳</span>' : ''}
          <span style="flex:1;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeAttr(item.input || '')}">${escapeHtml(truncate(item.input || '', 60))}</span>
          <span class="badge badge-${item.status}" style="font-size:9px;padding:1px 6px;">${STATUS_LABELS[item.status] || item.status}</span>
        </div>
      `;
        }).join('');
        const remaining = total - 5;
        const moreHtml = remaining > 0 ? `<div style="font-size:11px;color:var(--text-muted);padding:2px 0;">... 还有 ${remaining} 项</div>` : '';
        return `
      <div class="card queue-card hover-lift" data-id="${queue.id}" style="margin-bottom:8px;cursor:pointer;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
            <div style="min-width:0;flex:1;">
              <div class="card-title" style="font-size:14px;margin-bottom:4px;" title="${escapeAttr(queue.name)}">${escapeHtml(queue.name)}</div>
              <div style="display:flex;align-items:center;gap:8px;font-size:11px;">
                ${StatusBadge.render(queue.status)}
                ${queue.status === 'running' ? '<span class="running-indicator"></span>' : ''}
                ${wf ? `<span style="color:var(--text-tertiary);">${Icon.svg('workflow', 14)} ${escapeHtml(wf.name)}</span>` : ''}
                <span style="color:var(--text-muted);font-family:var(--font-mono);">${timeAgo}</span>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:4px;margin-left:12px;">
            ${queue.status === 'pending' || queue.status === 'paused' ? `<button class="btn btn-sm btn-success btn-start" title="开始">${Icon.svg('play', 14)}</button>` : ''}
            ${queue.status === 'running' ? `<button class="btn btn-sm btn-secondary btn-pause" title="暂停">${Icon.svg('pause', 14)}</button>` : ''}
            ${queue.status === 'paused' ? `<button class="btn btn-sm btn-secondary btn-resume" title="继续">⏵</button>` : ''}
            ${queue.status === 'running' || queue.status === 'paused' ? `<button class="btn btn-sm btn-danger btn-cancel" title="取消">${Icon.svg('stop', 14)}</button>` : ''}
            ${queue.status !== 'running' ? `<button class="btn btn-sm btn-danger btn-delete" title="删除">${Icon.svg('delete', 14)}</button>` : ''}
          </div>
        </div>
        <div style="margin-bottom:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:11px;color:var(--text-muted);">进度</span>
            <span style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);">${completed}/${total} (${percent}%)</span>
          </div>
          <div class="queue-progress-bar" style="width:100%;height:4px;background:var(--bg-tertiary);border-radius:2px;overflow:hidden;">
            <div class="queue-progress-fill" style="width:${percent}%;height:100%;background:${queue.status === 'failed' ? 'var(--accent-red)' : queue.status === 'completed' ? 'var(--accent-green)' : 'var(--accent-cyan)'};border-radius:2px;transition:width 0.5s ease;"></div>
          </div>
        </div>
        ${total > 0 ? `<div style="border-top:1px solid var(--border-subtle);padding-top:6px;">${itemPreview}${moreHtml}</div>` : ''}
      </div>
    `;
    }
    function renderPagination(total, totalPages) {
        let paginationEl = document.getElementById('queues-pagination');
        if (!paginationEl) {
            const container = document.getElementById('queues-list');
            if (!container)
                return;
            paginationEl = document.createElement('div');
            paginationEl.id = 'queues-pagination';
            paginationEl.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:12px;margin-top:16px;';
            container.parentNode.insertBefore(paginationEl, container.nextSibling);
        }
        if (totalPages <= 1) {
            paginationEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">显示 ${total} / ${total} 条</span>`;
            return;
        }
        const start = (currentPage - 1) * PAGE_SIZE + 1;
        const end = Math.min(currentPage * PAGE_SIZE, total);
        paginationEl.innerHTML = `
      <span style="font-size:12px;color:var(--text-muted);">显示 ${start}-${end} / ${total} 条</span>
      <button class="btn btn-sm btn-ghost" id="queues-prev" ${currentPage <= 1 ? 'disabled' : ''}>上一页</button>
      <span style="font-size:12px;color:var(--text-muted);">第 ${currentPage} / ${totalPages} 页</span>
      <button class="btn btn-sm btn-ghost" id="queues-next" ${currentPage >= totalPages ? 'disabled' : ''}>下一页</button>
    `;
        document.getElementById('queues-prev')?.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderList();
            }
        });
        document.getElementById('queues-next')?.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                renderList();
            }
        });
    }
    function onQueueUpdate() {
        loadQueues().then(() => renderList());
    }
    function openDetail(queueId) {
        TaskQueueDetail.open(queueId);
    }
    function openCreateModal() {
        let queueItems = [{ input: '' }];
        function renderForm() {
            return `
        <div class="form-group">
          <label class="form-label">队列名称 *</label>
          <input class="input" id="queue-name" placeholder="输入队列名称" maxlength="200">
        </div>
        <div class="form-group">
          <label class="form-label">描述</label>
          <textarea class="textarea" id="queue-desc" placeholder="队列描述" maxlength="2000" rows="2"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">工作流 *</label>
          <select class="select" id="queue-workflow">
            <option value="">选择工作流</option>
            ${workflows.map((w) => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="queue-stop-on-error" checked>
            <span>遇到错误时停止</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-label">任务列表</label>
          <div id="queue-items-list">
            ${queueItems.map((item, idx) => renderItemInput(idx, item.input)).join('')}
          </div>
          <button class="btn btn-sm btn-ghost" id="add-queue-item-btn" style="margin-top:8px;">+ 添加任务</button>
        </div>
      `;
        }
        Modal.open({
            title: '创建任务队列',
            body: renderForm(),
            footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="queue-submit-btn">确认创建</button>
      `,
        });
        bindCreateEvents(queueItems);
    }
    function renderItemInput(idx, value) {
        return `
      <div class="queue-item-input" data-idx="${idx}" style="display:flex;gap:8px;margin-bottom:8px;align-items:flex-start;">
        <span style="color:var(--text-muted);font-family:var(--font-mono);font-size:11px;padding-top:8px;width:20px;text-align:right;">#${idx + 1}</span>
        <textarea class="textarea queue-item-text" data-idx="${idx}" placeholder="输入任务提示词..." rows="2" style="flex:1;min-height:40px;">${escapeHtml(value)}</textarea>
        <button class="btn btn-sm btn-ghost remove-queue-item-btn" data-idx="${idx}" title="移除" style="margin-top:4px;color:var(--accent-red);">${Icon.svg('close', 14)}</button>
      </div>
    `;
    }
    function bindCreateEvents(queueItems) {
        function refreshItems() {
            const list = document.getElementById('queue-items-list');
            if (!list)
                return;
            list.innerHTML = queueItems.map((item, idx) => renderItemInput(idx, item.input)).join('');
            bindItemEvents();
        }
        function bindItemEvents() {
            document.querySelectorAll('.queue-item-text').forEach((el) => {
                el.addEventListener('input', (e) => {
                    const idx = parseInt(e.target.dataset.idx);
                    if (queueItems[idx])
                        queueItems[idx].input = e.target.value;
                });
            });
            document.querySelectorAll('.remove-queue-item-btn').forEach((el) => {
                el.addEventListener('click', (e) => {
                    const idx = parseInt(e.target.dataset.idx);
                    if (queueItems.length <= 1) {
                        Toast.warning('至少需要一个任务');
                        return;
                    }
                    queueItems.splice(idx, 1);
                    refreshItems();
                });
            });
        }
        bindItemEvents();
        document.getElementById('add-queue-item-btn')?.addEventListener('click', () => {
            queueItems.push({ input: '' });
            refreshItems();
        });
        document.getElementById('queue-submit-btn')?.addEventListener('click', async () => {
            // Sync latest values from textareas
            document.querySelectorAll('.queue-item-text').forEach((el) => {
                const idx = parseInt(el.dataset.idx);
                if (queueItems[idx])
                    queueItems[idx].input = el.value;
            });
            const name = document.getElementById('queue-name')?.value.trim();
            const description = document.getElementById('queue-desc')?.value.trim();
            const workflowId = document.getElementById('queue-workflow')?.value;
            const stopOnError = document.getElementById('queue-stop-on-error')?.checked;
            if (!name) {
                Toast.warning('队列名称为必填项');
                return;
            }
            if (!workflowId) {
                Toast.warning('请选择工作流');
                return;
            }
            const validItems = queueItems.filter((i) => i.input.trim());
            if (validItems.length === 0) {
                Toast.warning('至少需要一个有效任务');
                return;
            }
            const btn = document.getElementById('queue-submit-btn');
            if (btn) {
                btn.disabled = true;
                btn.textContent = '创建中...';
            }
            try {
                await API.createTaskQueue({
                    name,
                    description,
                    workflowId,
                    stopOnError,
                    items: validItems,
                });
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
                    btn.textContent = '确认创建';
                }
            }
        });
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
                btn.textContent = '⏵';
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
                btn.innerHTML = Icon.svg('delete', 14);
            }
        }
    }
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
    function cleanup() {
        _wsUnsubs.forEach((fn) => fn());
        _wsUnsubs = [];
        if (_storeUnsub) {
            _storeUnsub();
            _storeUnsub = null;
        }
    }
    return { render, cleanup };
})();
