// ═══════════════════════════════════════════════
// Task Queue Detail — Detail View Modal
// ═══════════════════════════════════════════════

window.TaskQueueDetail = (() => {
  let _currentQueueId = null;
  let _refreshTimer = null;
  let _wsUnsubs = [];

  const STATUS_LABELS = {
    pending: '等待中',
    running: '执行中',
    paused: '已暂停',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    waiting_human: '等待人工',
  };

  function open(queueId) {
    _currentQueueId = queueId;
    loadAndRender();
  }

  async function loadAndRender() {
    if (!_currentQueueId) return;
    try {
      const res = await API.getTaskQueue(_currentQueueId);
      const queue = res.data;
      showDetail(queue);
    } catch (e) {
      Toast.error('加载队列详情失败');
    }
  }

  function showDetail(queue) {
    const items = queue.items || [];
    const total = items.length;
    const completed = items.filter(i => i.status === 'completed').length;
    const failed = items.filter(i => i.status === 'failed').length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    const body = renderDetail(queue, items, total, completed, failed, percent);
    const footer = renderFooter(queue);

    Modal.open({
      title: escapeHtml(queue.name),
      body,
      footer,
      onClose: cleanup,
    });

    bindActions(queue);
    startLiveRefreshIfNeeded(queue);
    subscribeWs();
  }

  function renderDetail(queue, items, total, completed, failed, percent) {
    const progressColor = queue.status === 'failed' ? 'var(--accent-red)' :
      queue.status === 'completed' ? 'var(--accent-green)' : 'var(--accent-cyan)';

    return `
      <!-- Queue Metadata -->
      <div style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          ${StatusBadge.render(queue.status)}
          ${queue.status === 'running' ? '<span class="running-indicator"></span>' : ''}
          ${queue.workflowName ? `<span style="color:var(--text-tertiary);font-size:12px;">${Icon.svg('workflow', 14)} ${escapeHtml(queue.workflowName)}</span>` : ''}
        </div>
        ${queue.description ? `<p style="color:var(--text-secondary);font-size:13px;margin-bottom:8px;">${escapeHtml(queue.description)}</p>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">
          <div>
            <span style="color:var(--text-muted);">创建时间: </span>
            <span style="color:var(--text-secondary);">${queue.createdAt ? new Date(queue.createdAt).toLocaleString() : '--'}</span>
          </div>
          <div>
            <span style="color:var(--text-muted);">更新时间: </span>
            <span style="color:var(--text-secondary);">${queue.updatedAt ? new Date(queue.updatedAt).toLocaleString() : '--'}</span>
          </div>
          ${queue.startedAt ? `<div><span style="color:var(--text-muted);">开始时间: </span><span style="color:var(--text-secondary);">${new Date(queue.startedAt).toLocaleString()}</span></div>` : ''}
          ${queue.completedAt ? `<div><span style="color:var(--text-muted);">完成时间: </span><span style="color:var(--text-secondary);">${new Date(queue.completedAt).toLocaleString()}</span></div>` : ''}
        </div>
      </div>

      <!-- Overall Progress -->
      <div style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:12px;font-weight:600;color:var(--text-secondary);">总体进度</span>
          <span style="font-size:12px;color:var(--text-secondary);font-family:var(--font-mono);">${completed}/${total} 已完成${failed > 0 ? ` (${failed} 失败)` : ''}</span>
        </div>
        <div style="width:100%;height:6px;background:var(--bg-tertiary);border-radius:3px;overflow:hidden;">
          <div style="width:${percent}%;height:100%;background:${progressColor};border-radius:3px;transition:width 0.5s ease;"></div>
        </div>
      </div>

      <!-- Items Table -->
      <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--text-secondary);">任务列表</div>
      <div class="table-container" style="max-height:400px;overflow-y:auto;">
        <table class="table">
          <thead>
            <tr>
              <th style="width:40px;">#</th>
              <th>输入</th>
              <th style="width:80px;">状态</th>
              <th style="width:160px;">时间</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item, idx) => renderItemRow(item, idx)).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderItemRow(item, idx) {
    const isRunning = item.status === 'running';
    const isWaiting = item.status === 'waiting_human';
    const isCompleted = item.status === 'completed';
    const isFailed = item.status === 'failed';

    const timeStr = item.startedAt
      ? `${new Date(item.startedAt).toLocaleTimeString()}${item.completedAt ? ' - ' + new Date(item.completedAt).toLocaleTimeString() : ''}`
      : '--';

    const outputId = `queue-item-output-${idx}`;

    return `
      <tr>
        <td style="font-family:var(--font-mono);color:var(--text-muted);font-size:11px;">${idx + 1}</td>
        <td>
          <div style="font-size:12px;color:var(--text-secondary);white-space:pre-wrap;word-break:break-all;max-height:60px;overflow-y:auto;">${escapeHtml(item.input || '')}</div>
          ${isWaiting && item.nodeName ? `<div style="font-size:11px;color:var(--accent-purple);margin-top:4px;">${Icon.svg('spinner', 14)} 等待人工响应: ${escapeHtml(item.nodeName)}</div>` : ''}
          ${isRunning ? `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;"><span class="spinner spinner-sm"></span><span style="font-size:11px;color:var(--accent-cyan);">执行中...</span></div>` : ''}
          ${isCompleted && item.output ? `
            <div style="margin-top:4px;">
              <button class="btn btn-sm btn-ghost toggle-output-btn" data-target="${outputId}" style="font-size:10px;padding:1px 6px;">展开输出</button>
              <pre id="${outputId}" style="display:none;font-size:11px;color:var(--accent-green);background:var(--bg-deep);padding:8px;border-radius:var(--border-radius);border:1px solid var(--border-subtle);max-height:150px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;margin-top:4px;font-family:var(--font-mono);">${escapeHtml(typeof item.output === 'string' ? item.output : JSON.stringify(item.output, null, 2))}</pre>
            </div>
          ` : ''}
          ${isFailed && item.error ? `
            <div style="font-size:11px;color:var(--accent-red);margin-top:4px;padding:6px;background:rgba(255,61,90,0.08);border-radius:var(--border-radius);border:1px solid rgba(255,61,90,0.15);">${escapeHtml(item.error)}</div>
          ` : ''}
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:4px;">
            ${isRunning ? '<span class="spinner spinner-sm"></span>' : ''}
            ${isWaiting ? `<span style="color:var(--accent-purple);animation:pulse 1.5s infinite;">${Icon.svg('spinner', 14)}</span>` : ''}
            <span class="badge badge-${item.status}" style="font-size:9px;padding:1px 6px;">${STATUS_LABELS[item.status] || item.status}</span>
          </div>
        </td>
        <td style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">${timeStr}</td>
      </tr>
    `;
  }

  function renderFooter(queue) {
    const canStart = queue.status === 'pending' || queue.status === 'paused';
    const canPause = queue.status === 'running';
    const canResume = queue.status === 'paused';
    const canCancel = queue.status === 'running' || queue.status === 'paused';
    const canDelete = queue.status !== 'running';

    return `
      <div style="display:flex;gap:8px;margin-right:auto;">
        ${canStart ? '<button class="btn btn-sm btn-success tqd-btn-start">开始</button>' : ''}
        ${canPause ? '<button class="btn btn-sm btn-secondary tqd-btn-pause">暂停</button>' : ''}
        ${canResume ? '<button class="btn btn-sm btn-secondary tqd-btn-resume">继续</button>' : ''}
        ${canCancel ? '<button class="btn btn-sm btn-danger tqd-btn-cancel">取消</button>' : ''}
        ${canDelete ? '<button class="btn btn-sm btn-danger tqd-btn-delete">删除</button>' : ''}
      </div>
      <button class="btn btn-secondary tqd-btn-close">关闭</button>
    `;
  }

  function bindActions(queue) {
    const id = queue.id;

    document.querySelector('.tqd-btn-close')?.addEventListener('click', () => {
      cleanup();
      Modal.close();
    });

    document.querySelector('.tqd-btn-start')?.addEventListener('click', async () => {
      const btn = document.querySelector('.tqd-btn-start');
      if (btn) { btn.disabled = true; btn.textContent = '...'; }
      try {
        await API.startTaskQueue(id);
        Toast.success('队列已开始');
        await loadAndRender();
      } catch (e) { Toast.error(e.message); if (btn) { btn.disabled = false; btn.textContent = '开始'; } }
    });

    document.querySelector('.tqd-btn-pause')?.addEventListener('click', async () => {
      const btn = document.querySelector('.tqd-btn-pause');
      if (btn) { btn.disabled = true; btn.textContent = '...'; }
      try {
        await API.pauseTaskQueue(id);
        Toast.success('队列已暂停');
        await loadAndRender();
      } catch (e) { Toast.error(e.message); if (btn) { btn.disabled = false; btn.textContent = '暂停'; } }
    });

    document.querySelector('.tqd-btn-resume')?.addEventListener('click', async () => {
      const btn = document.querySelector('.tqd-btn-resume');
      if (btn) { btn.disabled = true; btn.textContent = '...'; }
      try {
        await API.resumeTaskQueue(id);
        Toast.success('队列已继续');
        await loadAndRender();
      } catch (e) { Toast.error(e.message); if (btn) { btn.disabled = false; btn.textContent = '继续'; } }
    });

    document.querySelector('.tqd-btn-cancel')?.addEventListener('click', async () => {
      if (!await Modal.confirm('取消队列', '确定取消此队列？正在执行的任务将被中断。')) return;
      const btn = document.querySelector('.tqd-btn-cancel');
      if (btn) { btn.disabled = true; btn.textContent = '...'; }
      try {
        await API.cancelTaskQueue(id);
        Toast.success('队列已取消');
        await loadAndRender();
      } catch (e) { Toast.error(e.message); if (btn) { btn.disabled = false; btn.textContent = '取消'; } }
    });

    document.querySelector('.tqd-btn-delete')?.addEventListener('click', async () => {
      if (!await Modal.confirm('删除队列', '确定删除此队列？此操作不可撤销。')) return;
      const btn = document.querySelector('.tqd-btn-delete');
      if (btn) { btn.disabled = true; btn.textContent = '...'; }
      try {
        await API.deleteTaskQueue(id);
        Toast.success('队列已删除');
        cleanup();
        Modal.close();
      } catch (e) { Toast.error(e.message); if (btn) { btn.disabled = false; btn.textContent = '删除'; } }
    });

    // Toggle output buttons
    document.querySelectorAll('.toggle-output-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        if (!target) return;
        const visible = target.style.display !== 'none';
        target.style.display = visible ? 'none' : 'block';
        btn.textContent = visible ? '展开输出' : '收起输出';
      });
    });
  }

  function startLiveRefreshIfNeeded(queue) {
    stopLiveRefresh();
    if (queue.status === 'running' || queue.status === 'waiting_human') {
      _refreshTimer = setInterval(() => {
        loadAndRender();
      }, 3000);
    }
  }

  function stopLiveRefresh() {
    if (_refreshTimer) {
      clearInterval(_refreshTimer);
      _refreshTimer = null;
    }
  }

  function subscribeWs() {
    _wsUnsubs.forEach(fn => fn());
    _wsUnsubs = [];

    const events = [
      'queue.started', 'queue.itemStarted', 'queue.itemCompleted', 'queue.itemFailed',
      'queue.paused', 'queue.resumed', 'queue.completed', 'queue.failed',
      'queue.cancelled', 'queue.waitingHuman', 'queue.progress',
    ];

    events.forEach(evt => {
      _wsUnsubs.push(WS.on(evt, (payload) => {
        if (payload.queueId === _currentQueueId) {
          loadAndRender();
        }
      }));
    });
  }

  function cleanup() {
    stopLiveRefresh();
    _wsUnsubs.forEach(fn => fn());
    _wsUnsubs = [];
    _currentQueueId = null;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  return { open, cleanup };
})();
