"use strict";
window.AnalyticsPage = (() => {
    let _stats = null;
    let _timeline = [];
    let _selectedIds = new Set(); // "workflowId::runId"
    let _selectionMode = false;
    function escapeHtml(str) {
        if (!str)
            return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    async function render() {
        const el = document.getElementById('content');
        el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">${Icon.svg('analytics', 20)}</span> 数据分析</h1>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-secondary" id="analytics-select-btn">批量选择</button>
            <button class="btn btn-danger" id="analytics-batch-delete-btn" style="display:none;">删除选中</button>
            <button class="btn btn-secondary" id="analytics-refresh-btn">刷新</button>
          </div>
        </div>
        <div id="analytics-stats"></div>
        <div id="analytics-timeline" style="margin-top:24px;"></div>
      </div>
    `;
        document.getElementById('analytics-refresh-btn').addEventListener('click', () => {
            _selectedIds.clear();
            loadData();
        });
        document.getElementById('analytics-select-btn').addEventListener('click', toggleSelectionMode);
        document.getElementById('analytics-batch-delete-btn').addEventListener('click', batchDelete);
        await loadData();
    }
    function toggleSelectionMode() {
        _selectionMode = !_selectionMode;
        _selectedIds.clear();
        const btn = document.getElementById('analytics-select-btn');
        const deleteBtn = document.getElementById('analytics-batch-delete-btn');
        if (btn) {
            btn.textContent = _selectionMode ? '取消选择' : '批量选择';
            btn.style.borderColor = _selectionMode ? 'var(--accent-cyan)' : '';
        }
        if (deleteBtn)
            deleteBtn.style.display = _selectionMode ? '' : 'none';
        renderTimeline();
    }
    function toggleItem(key) {
        if (_selectedIds.has(key)) {
            _selectedIds.delete(key);
        }
        else {
            _selectedIds.add(key);
        }
        updateDeleteButton();
        // Update checkbox visual
        const cb = document.querySelector(`.analytics-cb[data-key="${key}"]`);
        if (cb)
            cb.checked = _selectedIds.has(key);
        const selectAll = document.getElementById('analytics-select-all');
        if (selectAll)
            selectAll.checked = _selectedIds.size === _timeline.length && _timeline.length > 0;
    }
    function updateDeleteButton() {
        const btn = document.getElementById('analytics-batch-delete-btn');
        if (btn) {
            btn.textContent = _selectedIds.size > 0 ? `删除选中 (${_selectedIds.size})` : '删除选中';
            btn.disabled = _selectedIds.size === 0;
        }
    }
    async function batchDelete() {
        if (_selectedIds.size === 0)
            return;
        const count = _selectedIds.size;
        if (!await Modal.confirm('批量删除执行记录', `确定删除 ${count} 条执行记录？删除后统计数据将重新计算。`))
            return;
        const items = Array.from(_selectedIds).map((key) => {
            const [workflowId, runId] = key.split('::');
            return { workflowId, runId };
        });
        try {
            const res = await API.batchDeleteExecutionLogs(items);
            const deleted = res.data?.deleted || 0;
            Toast.success(`已删除 ${deleted} 条执行记录`);
            _selectedIds.clear();
            _selectionMode = false;
            const btn = document.getElementById('analytics-select-btn');
            const deleteBtn = document.getElementById('analytics-batch-delete-btn');
            if (btn) {
                btn.textContent = '批量选择';
                btn.style.borderColor = '';
            }
            if (deleteBtn)
                deleteBtn.style.display = 'none';
            await loadData();
        }
        catch (e) {
            Toast.error(e.message || '删除失败');
        }
    }
    async function loadData() {
        await Promise.all([loadStats(), loadTimeline()]);
    }
    async function loadStats() {
        const el = document.getElementById('analytics-stats');
        if (!el)
            return;
        try {
            const res = await API.getWorkflowStatistics();
            _stats = res.data;
            el.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
          <div class="card" style="padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:var(--accent-cyan);">${_stats.total}</div>
            <div style="font-size:12px;color:var(--text-muted);">总执行次数</div>
          </div>
          <div class="card" style="padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:var(--accent-green);">${_stats.completed}</div>
            <div style="font-size:12px;color:var(--text-muted);">成功</div>
          </div>
          <div class="card" style="padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:var(--accent-red);">${_stats.failed}</div>
            <div style="font-size:12px;color:var(--text-muted);">失败</div>
          </div>
          <div class="card" style="padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:var(--accent-amber);">${_stats.successRate}%</div>
            <div style="font-size:12px;color:var(--text-muted);">成功率</div>
          </div>
          <div class="card" style="padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:var(--text-primary);">${_stats.avgDuration}s</div>
            <div style="font-size:12px;color:var(--text-muted);">平均耗时</div>
          </div>
        </div>
        ${_stats.byWorkflow.length > 0 ? `
          <div style="margin-top:16px;">
            <h3 style="font-size:14px;margin-bottom:12px;">按工作流统计</h3>
            <div style="display:grid;gap:8px;">
              ${_stats.byWorkflow.map((wf) => `
                <div class="card" style="padding:12px;display:flex;align-items:center;gap:12px;">
                  <div style="flex:1;">
                    <div style="font-weight:600;font-size:13px;">${escapeHtml(wf.name)}</div>
                    <div style="font-size:11px;color:var(--text-tertiary);">
                      ${wf.executions} 次执行 | 成功 ${wf.completed} | 失败 ${wf.failed} | 平均 ${wf.avgDuration}s
                    </div>
                  </div>
                  <div style="width:100px;height:8px;background:var(--bg-subtle);border-radius:4px;overflow:hidden;">
                    <div style="height:100%;width:${wf.executions > 0 ? Math.round(wf.completed / wf.executions * 100) : 0}%;background:var(--accent-green);border-radius:4px;"></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      `;
        }
        catch (e) {
            el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--accent-red);">加载失败: ${escapeHtml(e.message)}</div>`;
        }
    }
    async function loadTimeline() {
        const el = document.getElementById('analytics-timeline');
        if (!el)
            return;
        try {
            const res = await API.getWorkflowTimeline();
            _timeline = res.data?.items || [];
            renderTimeline();
        }
        catch (e) {
            el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--accent-red);">加载失败</div>`;
        }
    }
    function renderTimeline() {
        const el = document.getElementById('analytics-timeline');
        if (!el)
            return;
        if (_timeline.length === 0) {
            el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">暂无执行记录</div>';
            return;
        }
        const selectAllHtml = _selectionMode ? `
      <div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="analytics-select-all" ${_selectedIds.size === _timeline.length ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent-cyan);">
        <label for="analytics-select-all" style="font-size:12px;color:var(--text-secondary);cursor:pointer;">全选 (${_timeline.length} 条记录)</label>
      </div>
    ` : '';
        el.innerHTML = `
      <h3 style="font-size:14px;margin-bottom:12px;">执行时间线</h3>
      ${selectAllHtml}
      <div style="position:relative;padding-left:20px;">
        <div style="position:absolute;left:8px;top:0;bottom:0;width:2px;background:var(--border-subtle);"></div>
        ${_timeline.map((e) => {
            const key = `${e.workflowId}::${e.runId}`;
            const isChecked = _selectedIds.has(key);
            const checkboxHtml = _selectionMode ? `<input type="checkbox" class="analytics-cb" data-key="${key}" ${isChecked ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent-cyan);margin-right:8px;flex-shrink:0;">` : '';
            return `
            <div style="position:relative;margin-bottom:16px;padding-left:16px;display:flex;align-items:flex-start;">
              <div style="position:absolute;left:-4px;top:4px;width:12px;height:12px;border-radius:50%;background:${e.status === 'completed' ? 'var(--accent-green)' : e.status === 'failed' ? 'var(--accent-red)' : 'var(--accent-cyan)'};border:2px solid var(--bg-primary);"></div>
              ${checkboxHtml}
              <div class="card" style="padding:10px 12px;flex:1;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <div style="font-weight:600;font-size:13px;">${escapeHtml(e.workflowName)}</div>
                  <span style="font-size:10px;padding:2px 6px;border-radius:4px;background:${e.status === 'completed' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'};color:${e.status === 'completed' ? 'var(--accent-green)' : 'var(--accent-red)'};">${e.status}</span>
                </div>
                <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">
                  ${new Date(e.startedAt).toLocaleString('zh-CN')}
                  ${e.duration ? ` | 耗时 ${e.duration}s` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
        // Bind events
        if (_selectionMode) {
            el.querySelectorAll('.analytics-cb').forEach((cb) => {
                cb.addEventListener('change', () => toggleItem(cb.dataset.key));
            });
            const selectAll = document.getElementById('analytics-select-all');
            if (selectAll) {
                selectAll.addEventListener('change', () => {
                    if (selectAll.checked) {
                        _timeline.forEach((e) => _selectedIds.add(`${e.workflowId}::${e.runId}`));
                    }
                    else {
                        _selectedIds.clear();
                    }
                    updateDeleteButton();
                    el.querySelectorAll('.analytics-cb').forEach((cb) => {
                        cb.checked = _selectedIds.has(cb.dataset.key);
                    });
                });
            }
        }
    }
    function cleanup() {
        _selectedIds.clear();
        _selectionMode = false;
    }
    return { render, cleanup };
})();
