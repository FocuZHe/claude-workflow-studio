"use strict";
window.TaskDetail = (() => {
    let _currentTaskId = null;
    let _refreshTimer = null;
    let _wsUnsubs = [];
    let _agents = [];
    function open(task, agents = []) {
        _currentTaskId = task.id;
        _agents = agents;
        const agent = agents.find(a => a.id === task.assignedAgentId);
        window.Modal.open({
            title: task.title,
            body: renderDetail(task, agent),
            footer: `<button class="btn btn-secondary" id="task-detail-close-btn">关闭</button>`,
        });
        document.getElementById('task-detail-close-btn')?.addEventListener('click', () => {
            cleanup();
            window.Modal.close();
        });
        // 如果任务正在运行，启动实时刷新
        if (task.status === 'running') {
            startLiveRefresh(task.id, agents);
        }
        // Clean up previous listeners
        _wsUnsubs.forEach(fn => fn());
        _wsUnsubs = [];
        // 监听 WebSocket 事件
        _wsUnsubs.push(window.WS.on('task.progress', onProgress));
        _wsUnsubs.push(window.WS.on('task.completed', onCompleted));
        _wsUnsubs.push(window.WS.on('task.failed', onFailed));
    }
    function startLiveRefresh(taskId, agents) {
        _refreshTimer = setInterval(async () => {
            try {
                const res = await window.API.getTask(taskId);
                const task = res.data;
                const agent = agents.find(a => a.id === task.assignedAgentId);
                // 更新弹窗内容
                const body = document.querySelector('.modal-body');
                if (body) {
                    body.innerHTML = renderDetail(task, agent);
                }
                // 如果任务已完成/失败，停止刷新
                if (task.status !== 'running') {
                    stopLiveRefresh();
                }
            }
            catch (e) { /* ignore */ }
        }, 3000);
    }
    function stopLiveRefresh() {
        if (_refreshTimer) {
            clearInterval(_refreshTimer);
            _refreshTimer = null;
        }
    }
    function cleanup() {
        stopLiveRefresh();
        _wsUnsubs.forEach(fn => fn());
        _wsUnsubs = [];
        _currentTaskId = null;
    }
    function onProgress(payload) {
        if (payload.taskId !== _currentTaskId)
            return;
        if (payload.message) {
            const progressEl = document.getElementById('task-progress-msg');
            if (progressEl) {
                progressEl.textContent = payload.message;
                progressEl.style.display = '';
            }
        }
    }
    function onCompleted(payload) {
        if (payload.taskId !== _currentTaskId)
            return;
        stopLiveRefresh();
        refreshDetail();
    }
    function onFailed(payload) {
        if (payload.taskId !== _currentTaskId)
            return;
        stopLiveRefresh();
        refreshDetail();
    }
    async function refreshDetail() {
        if (!_currentTaskId)
            return;
        try {
            const res = await window.API.getTask(_currentTaskId);
            const task = res.data;
            const body = document.querySelector('.modal-body');
            if (body) {
                const agent = _agents.find(a => a.id === task.assignedAgentId);
                body.innerHTML = renderDetail(task, agent || null);
            }
        }
        catch (e) { /* ignore */ }
    }
    function renderDetail(task, agent) {
        return `
      <div style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          ${window.StatusBadge.render(task.status)}
          <span class="badge badge-${task.priority}">${{ low: '低', medium: '中', high: '高', urgent: '紧急' }[task.priority] || task.priority}</span>
          ${agent ? `<span style="color:var(--text-tertiary);font-size:12px;">分配给: ${escapeHtml(agent.name)}</span>` : ''}
        </div>
        <p style="color:var(--text-secondary);font-size:13px;">${escapeHtml(task.description || '暂无描述')}</p>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:12px;">
        <div>
          <span style="color:var(--text-muted);">创建时间:</span>
          <span style="color:var(--text-secondary);">${new Date(task.createdAt).toLocaleString()}</span>
        </div>
        <div>
          <span style="color:var(--text-muted);">更新时间:</span>
          <span style="color:var(--text-secondary);">${new Date(task.updatedAt).toLocaleString()}</span>
        </div>
        ${task.startedAt ? `<div><span style="color:var(--text-muted);">开始时间:</span><span style="color:var(--text-secondary);">${new Date(task.startedAt).toLocaleString()}</span></div>` : ''}
        ${task.completedAt ? `<div><span style="color:var(--text-muted);">完成时间:</span><span style="color:var(--text-secondary);">${new Date(task.completedAt).toLocaleString()}</span></div>` : ''}
        ${task.folderPath ? `<div style="grid-column:1/-1;"><span style="color:var(--text-muted);">工作文件夹:</span><span style="color:var(--text-secondary);font-family:var(--font-mono);">${escapeHtml(task.folderPath)}</span></div>` : ''}
      </div>

      ${task.input ? `
        <div style="margin-bottom:16px;">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text-secondary);">输入</div>
          <div style="background:var(--bg-deep);border:1px solid var(--border-subtle);border-radius:var(--border-radius);padding:12px;font-size:12px;font-family:var(--font-mono);color:var(--text-secondary);white-space:pre-wrap;max-height:120px;overflow-y:auto;">${escapeHtml(task.input)}</div>
        </div>
      ` : ''}

      ${task.output ? `
        <div style="margin-bottom:16px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <div style="font-size:12px;font-weight:600;color:var(--text-secondary);">输出</div>
            <button class="btn btn-sm btn-secondary" onclick="navigator.clipboard.writeText(document.getElementById('task-output-text').textContent).then(() => Toast.success('已复制到剪贴板')).catch(() => Toast.error('复制失败'))">复制输出</button>
          </div>
          <div id="task-output-text" style="background:var(--bg-deep);border:1px solid var(--border-subtle);border-radius:var(--border-radius);padding:12px;font-size:12px;font-family:var(--font-mono);color:var(--accent-green);white-space:pre-wrap;max-height:200px;overflow-y:auto;">${escapeHtml(task.output)}</div>
        </div>
      ` : ''}

      ${task.status === 'running' ? `
        <div style="margin-bottom:16px;">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text-secondary);">执行进度</div>
          <div id="task-progress-msg" style="background:var(--bg-deep);border:1px solid var(--border-subtle);border-radius:var(--border-radius);padding:12px;font-size:12px;color:var(--accent-amber);">
            正在执行中...
          </div>
        </div>
      ` : ''}

      <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text-secondary);">日志</div>
      ${window.LogViewer.render(task.logs || [], 'task-detail-logs')}
    `;
    }
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
    return { open, cleanup };
})();
