"use strict";
window.HistoryPage = (() => {
    let currentFilter = { status: '', search: '' };
    let _selectionMode = false;
    let _selectedIds = new Set();
    let _historyRecords = [];
    const PAGE_SIZE = 50;
    let _currentPage = 1;
    let _totalItems = 0;
    let _loadingMore = false;
    let _searchSeq = 0;
    function render() {
        const el = document.getElementById('content');
        el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">${Icon.svg('history', 20)}</span> 执行历史</h1>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-secondary" id="history-batch-select-btn">批量选择</button>
          </div>
        </div>
        <div class="card">
          <div class="card-header" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <select id="history-status-filter" style="padding:6px 12px;background:var(--bg-secondary);border:1px solid var(--border-subtle);border-radius:var(--border-radius);color:var(--text-primary);font-size:13px;">
              <option value="">全部状态</option>
              <option value="running">运行中</option>
              <option value="completed">已完成</option>
              <option value="failed">失败</option>
              <option value="cancelled">已取消</option>
            </select>
            <input type="text" id="history-search" placeholder="搜索工作流名称..." style="padding:6px 12px;background:var(--bg-secondary);border:1px solid var(--border-subtle);border-radius:var(--border-radius);color:var(--text-primary);font-size:13px;width:220px;">
            <button class="btn btn-secondary" id="history-refresh" style="margin-left:auto;">刷新</button>
          </div>
          <div class="card-body" id="history-list">
            ${LoadingState.render('加载中...')}
          </div>
        </div>
      </div>
    `;
        document.getElementById('history-status-filter').addEventListener('change', (e) => {
            currentFilter.status = e.target.value;
            _historyRecords = [];
            _currentPage = 1;
            _totalItems = 0;
            loadHistory(1);
        });
        document.getElementById('history-search').addEventListener('input', debounce((e) => {
            currentFilter.search = e.target.value;
            _historyRecords = [];
            _currentPage = 1;
            _totalItems = 0;
            loadHistory(1);
        }, 300));
        document.getElementById('history-refresh').addEventListener('click', () => {
            _historyRecords = [];
            _currentPage = 1;
            _totalItems = 0;
            loadHistory(1);
        });
        document.getElementById('history-batch-select-btn').addEventListener('click', toggleSelectionMode);
        loadHistory();
    }
    async function loadHistory(page) {
        if (page === undefined)
            page = 1;
        const listEl = document.getElementById('history-list');
        if (!listEl)
            return;
        if (_loadingMore)
            return;
        _loadingMore = true;
        const seq = ++_searchSeq;
        try {
            const params = { page, limit: PAGE_SIZE };
            if (currentFilter.status)
                params.status = currentFilter.status;
            if (currentFilter.search)
                params.workflowName = currentFilter.search;
            const res = await API.getHistory(params);
            if (seq !== _searchSeq) {
                _loadingMore = false;
                return;
            }
            const d = res.data;
            const items = Array.isArray(d) ? d : (d?.items || []);
            const meta = res.meta || {};
            if (page === 1) {
                _historyRecords = items;
            }
            else {
                _historyRecords = [..._historyRecords, ...items];
            }
            _currentPage = meta.page || page;
            _totalItems = meta.total || _historyRecords.length;
            if (_historyRecords.length === 0) {
                listEl.innerHTML = EmptyState.render({
                    icon: `${Icon.svg('history', 40)}`,
                    title: '暂无执行历史',
                    description: '执行工作流后，历史记录会显示在这里',
                    actionText: '查看工作流',
                    actionRoute: '/workflows'
                });
                return;
            }
            const checkboxHeader = _selectionMode ? '<th style="padding:10px 12px;width:30px;"><input type="checkbox" id="history-select-all" style="width:16px;height:16px;accent-color:var(--accent-cyan);cursor:pointer;"></th>' : '';
            listEl.innerHTML = `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:2px solid var(--border-subtle);text-align:left;">
                ${checkboxHeader}
                <th style="padding:10px 12px;color:var(--text-muted);font-weight:600;font-size:12px;">工作流名称</th>
                <th style="padding:10px 12px;color:var(--text-muted);font-weight:600;font-size:12px;">开始时间</th>
                <th style="padding:10px 12px;color:var(--text-muted);font-weight:600;font-size:12px;">结束时间</th>
                <th style="padding:10px 12px;color:var(--text-muted);font-weight:600;font-size:12px;">状态</th>
                <th style="padding:10px 12px;color:var(--text-muted);font-weight:600;font-size:12px;">节点数</th>
                <th style="padding:10px 12px;color:var(--text-muted);font-weight:600;font-size:12px;">耗时</th>
                <th style="padding:10px 12px;color:var(--text-muted);font-weight:600;font-size:12px;">操作</th>
              </tr>
            </thead>
            <tbody>
              ${_historyRecords.map((r) => renderHistoryRow(r)).join('')}
            </tbody>
          </table>
        </div>
        ${renderLoadMoreButton(_historyRecords.length, _totalItems, 'load-more-history')}
        <div style="text-align:center;padding:4px;font-size:12px;color:var(--text-muted);">已加载 ${_historyRecords.length} / ${_totalItems} 条</div>
      `;
            listEl.querySelectorAll('[data-detail-id]').forEach((btn) => {
                btn.addEventListener('click', () => showDetail(btn.dataset.detailId));
            });
            listEl.querySelectorAll('[data-delete-id]').forEach((btn) => {
                btn.addEventListener('click', () => deleteSingleHistory(btn.dataset.deleteId));
            });
            listEl.querySelectorAll('.history-batch-checkbox').forEach((cb) => {
                cb.addEventListener('change', () => toggleSelectItem(cb.dataset.id));
            });
            document.getElementById('history-select-all')?.addEventListener('change', (e) => {
                const allCbs = listEl.querySelectorAll('.history-batch-checkbox');
                allCbs.forEach((cb) => { cb.checked = e.target.checked; });
                if (e.target.checked) {
                    _historyRecords.forEach((r) => _selectedIds.add(r.id || r.runId));
                }
                else {
                    _selectedIds.clear();
                }
                updateBatchActionBar();
            });
            bindLoadMoreButton('load-more-history', () => loadHistory(_currentPage + 1));
        }
        catch (e) {
            listEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--accent-red);font-size:13px;">加载失败: ${escapeHtml(e.message)}</div>`;
        }
        finally {
            _loadingMore = false;
        }
    }
    function renderHistoryRow(record) {
        const start = record.startedAt ? new Date(record.startedAt).toLocaleString('zh-CN') : '--';
        const end = record.endedAt ? new Date(record.endedAt).toLocaleString('zh-CN') : '--';
        const duration = calcDuration(record.startedAt, record.endedAt);
        const status = record.status || 'unknown';
        const nodeCount = record.nodeCount || (record.nodes ? record.nodes.length : '--');
        const recordId = (record.id || record.runId);
        const isChecked = _selectedIds.has(recordId);
        const checkboxCell = _selectionMode ? `<td style="padding:10px 12px;width:30px;"><input type="checkbox" class="history-batch-checkbox" data-id="${recordId}" ${isChecked ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent-cyan);cursor:pointer;"></td>` : '';
        return `
      <tr style="border-bottom:1px solid var(--border-subtle);" class="history-row">
        ${checkboxCell}
        <td style="padding:10px 12px;color:var(--text-primary);font-weight:500;">${escapeHtml(record.workflowName || record.name || '--')}</td>
        <td style="padding:10px 12px;color:var(--text-secondary);font-family:var(--font-mono);font-size:12px;">${start}</td>
        <td style="padding:10px 12px;color:var(--text-secondary);font-family:var(--font-mono);font-size:12px;">${end}</td>
        <td style="padding:10px 12px;">${StatusBadge.render(status)}</td>
        <td style="padding:10px 12px;color:var(--text-secondary);font-family:var(--font-mono);">${nodeCount}</td>
        <td style="padding:10px 12px;color:var(--text-secondary);font-family:var(--font-mono);font-size:12px;">${duration}</td>
        <td style="padding:10px 12px;display:flex;gap:4px;">
          <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" data-detail-id="${recordId}">详情</button>
          <button class="btn btn-sm btn-danger" style="padding:4px 8px;font-size:11px;" data-delete-id="${recordId}" title="删除">${Icon.svg('delete', 14)}</button>
        </td>
      </tr>
    `;
    }
    function calcDuration(start, end) {
        if (!start)
            return '--';
        const s = new Date(start);
        const e = end ? new Date(end) : new Date();
        const diff = Math.floor((e.getTime() - s.getTime()) / 1000);
        if (diff < 0)
            return '--';
        if (diff < 60)
            return diff + '秒';
        if (diff < 3600)
            return Math.floor(diff / 60) + '分' + (diff % 60) + '秒';
        return Math.floor(diff / 3600) + '时' + Math.floor((diff % 3600) / 60) + '分';
    }
    async function showDetail(runId) {
        try {
            const res = await API.getHistoryDetail(runId);
            const data = res.data || {};
            const body = `
        <div style="max-height:60vh;overflow-y:auto;">
          <div style="margin-bottom:16px;">
            <div style="font-size:13px;color:var(--text-muted);margin-bottom:4px;">工作流名称</div>
            <div style="font-size:14px;color:var(--text-primary);font-weight:500;">${data.workflowName || data.name || '--'}</div>
          </div>
          <div style="display:flex;gap:16px;margin-bottom:16px;">
            <div>
              <div style="font-size:12px;color:var(--text-muted);">状态</div>
              <div>${StatusBadge.render(data.status)}</div>
            </div>
            <div>
              <div style="font-size:12px;color:var(--text-muted);">开始时间</div>
              <div style="font-size:13px;font-family:var(--font-mono);color:var(--text-secondary);">${data.startedAt ? new Date(data.startedAt).toLocaleString('zh-CN') : '--'}</div>
            </div>
            <div>
              <div style="font-size:12px;color:var(--text-muted);">结束时间</div>
              <div style="font-size:13px;font-family:var(--font-mono);color:var(--text-secondary);">${data.endedAt ? new Date(data.endedAt).toLocaleString('zh-CN') : '--'}</div>
            </div>
          </div>
          <div style="margin-bottom:16px;">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">执行时间线</div>
            ${Timeline.render(data)}
          </div>
          ${data.nodes ? data.nodes.map((node, i) => `
            <div style="margin-bottom:12px;padding:12px;background:var(--bg-secondary);border-radius:var(--border-radius);border:1px solid var(--border-subtle);">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="font-size:13px;font-weight:600;color:var(--text-primary);">节点 ${i + 1}: ${node.name || '--'}</span>
                ${StatusBadge.render(node.status)}
              </div>
              ${node.input ? `<div style="margin-bottom:6px;"><div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">输入</div><pre style="font-size:12px;color:var(--text-secondary);background:var(--bg-primary);padding:8px;border-radius:var(--border-radius);overflow-x:auto;max-height:100px;overflow-y:auto;margin:0;white-space:pre-wrap;word-break:break-all;">${escapeHtml(typeof node.input === 'string' ? node.input : JSON.stringify(node.input, null, 2))}</pre></div>` : ''}
              ${node.output ? `<div style="margin-bottom:6px;"><div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">输出</div><pre style="font-size:12px;color:var(--text-secondary);background:var(--bg-primary);padding:8px;border-radius:var(--border-radius);overflow-x:auto;max-height:100px;overflow-y:auto;margin:0;white-space:pre-wrap;word-break:break-all;">${escapeHtml(typeof node.output === 'string' ? node.output : JSON.stringify(node.output, null, 2))}</pre></div>` : ''}
              ${node.error ? `<div><div style="font-size:11px;color:var(--accent-red);margin-bottom:2px;">错误</div><pre style="font-size:12px;color:var(--accent-red);background:rgba(255,68,68,0.05);padding:8px;border-radius:var(--border-radius);overflow-x:auto;max-height:80px;overflow-y:auto;margin:0;white-space:pre-wrap;word-break:break-all;">${escapeHtml(node.error)}</pre></div>` : ''}
            </div>
          `).join('') : ''}
          ${data.log ? `
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">完整日志</div>
              <pre style="font-size:12px;color:var(--text-secondary);background:var(--bg-secondary);padding:12px;border-radius:var(--border-radius);max-height:200px;overflow-y:auto;margin:0;white-space:pre-wrap;word-break:break-all;font-family:var(--font-mono);">${escapeHtml(data.log)}</pre>
            </div>
          ` : ''}
        </div>
      `;
            const workflowId = data.workflowId || data.workflow_id;
            const detailRunId = data.id || data.runId;
            Modal.open({
                title: '执行详情',
                body: body,
                footer: workflowId ? `
          <button class="btn btn-secondary" onclick="Modal.close()">关闭</button>
          <button class="btn btn-secondary" id="view-report-btn">查看执行报告</button>
          <button class="btn btn-primary" id="history-view-wf-status">查看工作流状态</button>
        ` : `
          <button class="btn btn-secondary" onclick="Modal.close()">关闭</button>
          <button class="btn btn-secondary" id="view-report-btn">查看执行报告</button>
        `,
            });
            const reportBtn = document.getElementById('view-report-btn');
            if (reportBtn && workflowId && detailRunId) {
                reportBtn.addEventListener('click', async () => {
                    try {
                        const res = await API.getReport(workflowId, detailRunId);
                        Modal.close();
                        Modal.open({
                            title: '执行报告',
                            body: `<div style="font-family:var(--font-mono);font-size:12px;white-space:pre-wrap;max-height:500px;overflow:auto;">${escapeHtml(res.data?.content || '(无报告)')}</div>`,
                            footer: '<button class="btn btn-secondary" onclick="Modal.close()">关闭</button>'
                        });
                    }
                    catch (e) {
                        Toast.error('获取报告失败: ' + e.message);
                    }
                });
            }
            if (workflowId) {
                document.getElementById('history-view-wf-status')?.addEventListener('click', () => {
                    Modal.close();
                    if (typeof WorkflowsPage !== 'undefined' && WorkflowsPage.viewWorkflowStatus) {
                        WorkflowsPage.viewWorkflowStatus(workflowId);
                    }
                });
            }
        }
        catch (e) {
            Toast.error('加载详情失败: ' + e.message);
        }
    }
    // ── Batch Selection ──────────────────────────────────────────
    function toggleSelectionMode() {
        _selectionMode = !_selectionMode;
        if (!_selectionMode) {
            _selectedIds.clear();
            removeBatchActionBar();
        }
        loadHistory();
    }
    function toggleSelectItem(id) {
        if (_selectedIds.has(id)) {
            _selectedIds.delete(id);
        }
        else {
            _selectedIds.add(id);
        }
        updateBatchActionBar();
    }
    function showBatchActionBar() {
        removeBatchActionBar();
        const bar = document.createElement('div');
        bar.id = 'batch-action-bar';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999;display:flex;align-items:center;gap:16px;padding:10px 24px;background:var(--bg-secondary);border-bottom:2px solid var(--accent-cyan);box-shadow:0 4px 16px rgba(0,0,0,0.3);';
        bar.innerHTML = `
      <span style="font-size:13px;color:var(--text-secondary);">已选择 <strong id="batch-count" style="color:var(--accent-cyan);">${_selectedIds.size}</strong> 项</span>
      <button class="btn btn-sm btn-danger" id="batch-delete-btn">批量删除</button>
      <button class="btn btn-sm btn-secondary" id="batch-cancel-btn">取消选择</button>
    `;
        document.body.appendChild(bar);
        document.getElementById('batch-delete-btn').addEventListener('click', batchDelete);
        document.getElementById('batch-cancel-btn').addEventListener('click', () => { _selectionMode = false; _selectedIds.clear(); removeBatchActionBar(); loadHistory(); });
    }
    function removeBatchActionBar() {
        document.getElementById('batch-action-bar')?.remove();
    }
    function updateBatchActionBar() {
        const countEl = document.getElementById('batch-count');
        if (countEl)
            countEl.textContent = String(_selectedIds.size);
        if (_selectedIds.size > 0 && !document.getElementById('batch-action-bar')) {
            showBatchActionBar();
        }
        else if (_selectedIds.size === 0) {
            removeBatchActionBar();
        }
    }
    async function deleteSingleHistory(runId) {
        if (!await Modal.confirm('删除记录', '确定删除此执行记录？此操作不可撤销。'))
            return;
        try {
            await API.deleteHistory(runId);
            Toast.success('记录已删除');
            await loadHistory();
        }
        catch (e) {
            Toast.error('删除失败: ' + e.message);
        }
    }
    async function batchDelete() {
        if (_selectedIds.size === 0)
            return;
        if (!await Modal.confirm('批量删除', `确定删除选中的 ${_selectedIds.size} 条执行记录？此操作不可撤销。`))
            return;
        const runIds = Array.from(_selectedIds);
        try {
            await API.deleteHistoryBatch(runIds);
            Toast.success(`已删除 ${runIds.length} 条记录`);
            _selectionMode = false;
            _selectedIds.clear();
            removeBatchActionBar();
            await loadHistory();
        }
        catch (e) {
            Toast.error('批量删除失败: ' + e.message);
        }
    }
    return { render };
})();
