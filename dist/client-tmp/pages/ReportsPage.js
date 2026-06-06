"use strict";
window.ReportsPage = (() => {
    let currentFilter = { search: '', workflowId: '' };
    let _reports = [];
    const PAGE_SIZE = 20;
    let _currentPage = 1;
    let _totalItems = 0;
    let _loadingMore = false;
    function render() {
        const el = document.getElementById('content');
        if (!el)
            return;
        el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">${Icon.svg('reports', 20)}</span> 执行报告</h1>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-primary" id="report-generate-btn">生成报告</button>
            <button class="btn btn-secondary" id="report-refresh">刷新</button>
          </div>
        </div>
        <div class="card">
          <div class="card-header" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
            <input type="text" id="report-search" placeholder="搜索工作流名称..." style="padding:6px 12px;background:var(--bg-secondary);border:1px solid var(--border-subtle);border-radius:var(--border-radius);color:var(--text-primary);font-size:13px;width:220px;">
            <select id="report-workflow-filter" style="padding:6px 12px;background:var(--bg-secondary);border:1px solid var(--border-subtle);border-radius:var(--border-radius);color:var(--text-primary);font-size:13px;">
              <option value="">全部工作流</option>
            </select>
          </div>
          <div class="card-body" id="report-list">
            <div style="display:flex;align-items:center;justify-content:center;padding:40px;">
              <span class="spinner spinner-sm"></span>
              <span style="margin-left:8px;color:var(--text-muted);font-size:13px;">加载中...</span>
            </div>
          </div>
        </div>
      </div>
    `;
        // Bind events
        document.getElementById('report-search').addEventListener('input', debounce((e) => {
            currentFilter.search = e.target.value;
            _reports = [];
            _currentPage = 1;
            _totalItems = 0;
            loadReports(1);
        }, 300));
        document.getElementById('report-workflow-filter').addEventListener('change', (e) => {
            currentFilter.workflowId = e.target.value;
            _reports = [];
            _currentPage = 1;
            _totalItems = 0;
            loadReports(1);
        });
        document.getElementById('report-refresh').addEventListener('click', () => {
            _reports = [];
            _currentPage = 1;
            _totalItems = 0;
            loadReports(1);
        });
        document.getElementById('report-generate-btn').addEventListener('click', openGenerateModal);
        // Load workflow options for filter dropdown
        loadWorkflowOptions();
        loadReports();
    }
    function debounce(fn, delay) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }
    async function loadWorkflowOptions() {
        try {
            const res = await API.getWorkflows();
            const d = res.data;
            const workflows = Array.isArray(d) ? d : (d?.items || []);
            const select = document.getElementById('report-workflow-filter');
            if (!select)
                return;
            workflows.forEach((wf) => {
                const opt = document.createElement('option');
                opt.value = wf.id;
                opt.textContent = wf.name || wf.id;
                select.appendChild(opt);
            });
        }
        catch (e) {
            console.warn('加载工作流列表失败:', e.message);
        }
    }
    async function loadReports(page) {
        if (page === undefined)
            page = 1;
        const listEl = document.getElementById('report-list');
        if (!listEl)
            return;
        if (_loadingMore)
            return;
        _loadingMore = true;
        if (page === 1) {
            listEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;padding:40px;">
          <span class="spinner spinner-sm"></span>
          <span style="margin-left:8px;color:var(--text-muted);font-size:13px;">加载中...</span>
        </div>
      `;
        }
        try {
            const params = { page, limit: PAGE_SIZE };
            if (currentFilter.search)
                params.search = currentFilter.search;
            if (currentFilter.workflowId)
                params.workflowId = currentFilter.workflowId;
            const res = await API.getReports(params);
            const data = res.data || {};
            const items = data.items || (Array.isArray(res.data) ? res.data : []);
            const meta = data.total !== undefined ? data : (res.meta || {});
            if (page === 1) {
                _reports = items;
            }
            else {
                _reports = [..._reports, ...items];
            }
            _currentPage = meta.page || page;
            _totalItems = meta.total || _reports.length;
            if (_reports.length === 0) {
                listEl.innerHTML = `
          <div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px;">
            <div style="font-size:32px;margin-bottom:8px;">${Icon.svg('reports', 32)}</div>
            <div>暂无执行报告</div>
            <div style="margin-top:8px;font-size:12px;">点击"生成报告"按钮创建新报告</div>
          </div>
        `;
                return;
            }
            listEl.innerHTML = `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:2px solid var(--border-subtle);text-align:left;">
                <th style="padding:10px 12px;color:var(--text-muted);font-weight:600;font-size:12px;">工作流名称</th>
                <th style="padding:10px 12px;color:var(--text-muted);font-weight:600;font-size:12px;">运行ID</th>
                <th style="padding:10px 12px;color:var(--text-muted);font-weight:600;font-size:12px;">状态</th>
                <th style="padding:10px 12px;color:var(--text-muted);font-weight:600;font-size:12px;">创建时间</th>
                <th style="padding:10px 12px;color:var(--text-muted);font-weight:600;font-size:12px;">文件大小</th>
                <th style="padding:10px 12px;color:var(--text-muted);font-weight:600;font-size:12px;">操作</th>
              </tr>
            </thead>
            <tbody>
              ${_reports.map((r) => renderReportRow(r)).join('')}
            </tbody>
          </table>
        </div>
        ${renderLoadMoreButton(_reports.length, _totalItems, 'load-more-reports')}
        <div style="text-align:center;padding:4px;font-size:12px;color:var(--text-muted);">已加载 ${_reports.length} / ${_totalItems} 条</div>
      `;
            // Bind row action buttons
            listEl.querySelectorAll('[data-view-id]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const [wfId, runId] = btn.dataset.viewId.split('::');
                    viewReport(wfId, runId);
                });
            });
            listEl.querySelectorAll('[data-download-id]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const [wfId, runId] = btn.dataset.downloadId.split('::');
                    downloadReport(wfId, runId);
                });
            });
            listEl.querySelectorAll('[data-delete-id]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const [wfId, runId] = btn.dataset.deleteId.split('::');
                    deleteReport(wfId, runId);
                });
            });
            bindLoadMoreButton('load-more-reports', () => loadReports(_currentPage + 1));
        }
        catch (e) {
            listEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--accent-red);font-size:13px;">加载失败: ${escapeHtml(e.message)}</div>`;
        }
        finally {
            _loadingMore = false;
        }
    }
    function renderReportRow(report) {
        const wfId = report.workflowId || report.workflow_id || '';
        const runId = report.runId || report.run_id || '';
        const wfName = report.workflowName || report.workflow_name || '--';
        const status = report.status || 'completed';
        const createdAt = report.createdAt || report.created_at
            ? new Date(report.createdAt || report.created_at).toLocaleString('zh-CN')
            : '--';
        const fileSize = report.fileSize || report.file_size || report.size || '--';
        const displaySize = typeof fileSize === 'number' ? formatFileSize(fileSize) : fileSize;
        return `
      <tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:10px 12px;color:var(--text-primary);font-weight:500;">${escapeHtml(wfName)}</td>
        <td style="padding:10px 12px;color:var(--text-secondary);font-family:var(--font-mono);font-size:12px;" title="${escapeHtml(runId)}">${escapeHtml(truncateId(runId))}</td>
        <td style="padding:10px 12px;">${StatusBadge.render(status)}</td>
        <td style="padding:10px 12px;color:var(--text-secondary);font-family:var(--font-mono);font-size:12px;">${escapeHtml(createdAt)}</td>
        <td style="padding:10px 12px;color:var(--text-secondary);font-family:var(--font-mono);font-size:12px;">${escapeHtml(String(displaySize))}</td>
        <td style="padding:10px 12px;display:flex;gap:4px;">
          <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" data-view-id="${wfId}::${runId}">查看</button>
          <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" data-download-id="${wfId}::${runId}">下载</button>
          <button class="btn btn-sm btn-danger" style="padding:4px 8px;font-size:11px;" data-delete-id="${wfId}::${runId}" title="删除">${Icon.svg('delete', 14)}</button>
        </td>
      </tr>
    `;
    }
    function truncateId(id) {
        if (!id)
            return '--';
        if (id.length <= 12)
            return id;
        return id.substring(0, 8) + '...';
    }
    function formatFileSize(bytes) {
        if (bytes === 0)
            return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
    }
    // ── Generate Report ──────────────────────────────────────────
    async function openGenerateModal() {
        let workflows = [];
        try {
            const res = await API.getWorkflows();
            const d = res.data;
            workflows = Array.isArray(d) ? d : (d?.items || []);
        }
        catch (e) {
            Toast.error('加载工作流列表失败: ' + e.message);
            return;
        }
        const body = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div>
          <label style="display:block;font-size:13px;color:var(--text-muted);margin-bottom:6px;">选择工作流</label>
          <select id="gen-report-workflow" style="width:100%;padding:8px 12px;background:var(--bg-secondary);border:1px solid var(--border-subtle);border-radius:var(--border-radius);color:var(--text-primary);font-size:13px;">
            <option value="">-- 请选择工作流 --</option>
            ${workflows.map((wf) => `<option value="${wf.id}">${escapeHtml(wf.name || wf.id)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:13px;color:var(--text-muted);margin-bottom:6px;">选择运行记录</label>
          <select id="gen-report-run" style="width:100%;padding:8px 12px;background:var(--bg-secondary);border:1px solid var(--border-subtle);border-radius:var(--border-radius);color:var(--text-primary);font-size:13px;" disabled>
            <option value="">-- 请先选择工作流 --</option>
          </select>
        </div>
      </div>
    `;
        Modal.open({
            title: '生成执行报告',
            body: body,
            footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="gen-report-submit" disabled>生成</button>
      `,
        });
        // When workflow is selected, load its history records
        const workflowSelect = document.getElementById('gen-report-workflow');
        const runSelect = document.getElementById('gen-report-run');
        const submitBtn = document.getElementById('gen-report-submit');
        workflowSelect.addEventListener('change', async () => {
            const wfId = workflowSelect.value;
            runSelect.innerHTML = '<option value="">加载中...</option>';
            runSelect.disabled = true;
            submitBtn.disabled = true;
            if (!wfId) {
                runSelect.innerHTML = '<option value="">-- 请先选择工作流 --</option>';
                return;
            }
            try {
                const res = await API.getHistory({ workflowId: wfId });
                const d = res.data;
                const records = Array.isArray(d) ? d : (d?.items || []);
                if (records.length === 0) {
                    runSelect.innerHTML = '<option value="">暂无运行记录</option>';
                    return;
                }
                runSelect.innerHTML = '<option value="">-- 请选择运行记录 --</option>';
                records.forEach((r) => {
                    const rid = r.id || r.runId || '';
                    const name = r.workflowName || r.name || rid;
                    const time = r.startedAt ? new Date(r.startedAt).toLocaleString('zh-CN') : '';
                    const opt = document.createElement('option');
                    opt.value = rid;
                    opt.textContent = `${name} (${time})`;
                    runSelect.appendChild(opt);
                });
                runSelect.disabled = false;
            }
            catch (e) {
                runSelect.innerHTML = '<option value="">加载失败</option>';
                Toast.error('加载运行记录失败: ' + e.message);
            }
        });
        runSelect.addEventListener('change', () => {
            submitBtn.disabled = !runSelect.value;
        });
        submitBtn.addEventListener('click', async () => {
            const wfId = workflowSelect.value;
            const runId = runSelect.value;
            if (!wfId || !runId)
                return;
            submitBtn.disabled = true;
            submitBtn.textContent = '生成中...';
            try {
                await API.generateReport({ workflowId: wfId, runId: runId });
                Modal.close();
                Toast.success('报告生成成功');
                loadReports();
            }
            catch (e) {
                Toast.error('报告生成失败: ' + e.message);
                submitBtn.disabled = false;
                submitBtn.textContent = '生成';
            }
        });
    }
    // ── View Report ──────────────────────────────────────────
    async function viewReport(workflowId, runId) {
        try {
            const res = await API.getReport(workflowId, runId);
            const data = res.data || {};
            const content = data.content || data.markdown || '(无报告内容)';
            const body = `
        <div style="max-height:60vh;overflow:auto;">
          <div style="margin-bottom:12px;display:flex;gap:16px;font-size:12px;color:var(--text-muted);">
            <span>工作流: <strong style="color:var(--text-primary);">${escapeHtml(data.workflowName || data.workflow_name || '--')}</strong></span>
            <span>运行ID: <strong style="color:var(--text-primary);font-family:var(--font-mono);">${escapeHtml(runId)}</strong></span>
          </div>
          <pre style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);background:var(--bg-primary);padding:16px;border-radius:var(--border-radius);white-space:pre-wrap;word-break:break-all;overflow-x:auto;margin:0;line-height:1.6;max-height:50vh;">${escapeHtml(content)}</pre>
        </div>
      `;
            Modal.open({
                title: '查看执行报告',
                body: body,
                footer: `
          <button class="btn btn-secondary" onclick="Modal.close()">关闭</button>
          <button class="btn btn-primary" id="view-report-download-btn">下载报告</button>
        `,
            });
            document.getElementById('view-report-download-btn')?.addEventListener('click', () => {
                downloadReport(workflowId, runId);
            });
        }
        catch (e) {
            Toast.error('获取报告失败: ' + e.message);
        }
    }
    // ── Download Report ──────────────────────────────────────────
    async function downloadReport(workflowId, runId) {
        try {
            const res = await API.exportReport(workflowId, runId);
            const content = res.data?.content || res.data?.markdown || '';
            const filename = `report_${workflowId}_${runId}.md`;
            // Trigger browser download
            const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            Toast.success('报告已下载');
        }
        catch (e) {
            Toast.error('下载报告失败: ' + e.message);
        }
    }
    // ── Delete Report ──────────────────────────────────────────
    async function deleteReport(workflowId, runId) {
        if (!await Modal.confirm('删除报告', '确定删除此执行报告？此操作不可撤销。'))
            return;
        try {
            await API.deleteReport(workflowId, runId);
            Toast.success('报告已删除');
            await loadReports();
        }
        catch (e) {
            Toast.error('删除报告失败: ' + e.message);
        }
    }
    // ── Helpers ──────────────────────────────────────────
    function escapeHtml(str) {
        if (!str)
            return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    return { render };
})();
