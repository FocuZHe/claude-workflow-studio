// ═══════════════════════════════════════════════
// Broadcast Page — Event Center + Manual Broadcast
// ═══════════════════════════════════════════════

window.BroadcastPage = (() => {
  let systemEvents = [];
  let manualHistory = [];
  let paused = false;
  let activeFilter = 'all';
  const MAX_EVENTS = 200;

  // Stream throttling state
  let _lastStreamRender = 0;
  let _streamBuffer = [];

  // Listener references for cleanup
  let _listeners = {};
  let _wsUnsubs = [];

  const SYSTEM_EVENT_TYPES = [
    'claude.stream',
    'workflow.statusUpdate',
    'workflow.nodeUpdate',
    'workflow.humanIntervention',
    'workflow.approvalDecision',
    'workflow.inputReceived',
    'task.completed',
    'task.failed',
    'alert',
    'client.count'
  ];

  const FILTER_MAP = {
    all:    { label: '全部', types: null },
    workflow: { label: '工作流', types: ['workflow.statusUpdate', 'workflow.nodeUpdate'] },
    task:   { label: '任务', types: ['task.completed', 'task.failed'] },
    claude: { label: 'Claude', types: ['claude.stream'] },
    alert:  { label: '告警', types: ['alert'] }
  };

  // ── Event type display helpers ──

  const EVENT_STYLES = {
    workflow:  { color: 'var(--accent-cyan)',   icon: Icon.svg('workflow', 12), label: '工作流' },
    task:      { color: 'var(--accent-green)',  icon: Icon.svg('tasks', 12), label: '任务' },
    claude:    { color: 'var(--accent-amber)',  icon: Icon.svg('play', 12), label: 'Claude' },
    alert:     { color: 'var(--accent-red)',    icon: Icon.svg('warning', 12), label: '告警' },
    other:     { color: 'var(--text-muted)',    icon: Icon.svg('info', 12), label: '系统' }
  };

  function getEventCategory(type) {
    if (type.startsWith('workflow.')) return 'workflow';
    if (type.startsWith('task.')) return 'task';
    if (type === 'claude.stream') return 'claude';
    if (type === 'alert') return 'alert';
    return 'other';
  }

  function formatEventSummary(type, payload) {
    switch (type) {
      case 'claude.stream': {
        const chunk = (payload.chunk || '').replace(/\n/g, ' ').trim();
        const preview = chunk.length > 50 ? chunk.substring(0, 50) + '...' : chunk;
        return `[流] Agent ${payload.agentId || '?'}: ${preview}`;
      }
      case 'workflow.statusUpdate':
        return `[工作流] ${payload.workflowName || payload.workflowId || '?'}: ${payload.status || '?'}`;
      case 'workflow.nodeUpdate':
        return `[节点] ${payload.label || payload.nodeId || '?'}: ${payload.status || '?'}`;

      case 'task.completed':
        return `[任务] ${payload.taskName || payload.taskId || '?'}: 完成`;
      case 'task.failed':
        return `[任务] ${payload.taskName || payload.taskId || '?'}: 失败 - ${payload.error || '未知错误'}`;
      case 'alert':
        return `[告警] ${payload.title || '?'}: ${payload.body || ''}`;
      case 'client.count':
        return `[系统] 客户端连接数: ${payload.count}`;
      default:
        return `[${type}] ${JSON.stringify(payload || {}).substring(0, 80)}`;
    }
  }

  // ── Render ──

  async function render() {
    const el = document.getElementById('content');
    el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">${Icon.svg('broadcast', 20)}</span> 事件中心</h1>
        </div>
        <div style="display:flex;gap:16px;flex:1;min-height:0;">
          <!-- LEFT: Event Stream -->
          <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
            <div class="card" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
              <div class="card-header" style="flex-shrink:0;">
                <h3 class="card-title">实时事件流</h3>
                <div style="display:flex;gap:6px;align-items:center;">
                  <button class="btn btn-sm ${paused ? 'btn-primary' : 'btn-secondary'}" id="ev-pause-btn">${paused ? Icon.svg('play', 14) + ' 继续' : Icon.svg('pause', 14) + ' 暂停'}</button>
                  <button class="btn btn-sm btn-ghost" id="ev-clear-btn">清空</button>
                  <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);" id="ev-count">0 条</span>
                </div>
              </div>
              <!-- Filter chips -->
              <div style="padding:8px 16px;display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--border-subtle);flex-shrink:0;" id="ev-filters">
                ${Object.entries(FILTER_MAP).map(([key, cfg]) => `
                  <button class="ev-filter-chip filter-chip ${activeFilter === key ? 'active' : ''}" data-filter="${key}">
                    ${cfg.label}
                  </button>
                `).join('')}
              </div>
              <!-- Event list -->
              <div id="event-stream" style="flex:1;overflow-y:auto;padding:0;">
                <div class="empty-state" style="padding:16px;"><div class="empty-desc">等待事件...</div></div>
              </div>
            </div>
          </div>

          <!-- RIGHT: Manual Broadcast -->
          <div style="width:340px;flex-shrink:0;display:flex;flex-direction:column;gap:12px;">
            <div class="card">
              <div class="card-header"><h3 class="card-title">发送广播</h3></div>
              <div class="card-body">
                <div class="form-group">
                  <label class="form-label">消息内容</label>
                  <textarea class="textarea" id="broadcast-msg" placeholder="请输入广播消息..." rows="3"></textarea>
                </div>
                <div class="form-group">
                  <label class="form-label">类型</label>
                  <select class="select" id="broadcast-type">
                    <option value="info">信息</option>
                    <option value="warning">警告</option>
                    <option value="error">错误</option>
                  </select>
                </div>
                <button class="btn btn-primary" id="broadcast-send-btn" style="width:100%;">发送广播</button>
              </div>
            </div>
            <div class="card" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
              <div class="card-header" style="flex-shrink:0;">
                <h3 class="card-title">广播历史</h3>
                <button class="btn btn-sm btn-ghost" id="refresh-history-btn">↻</button>
              </div>
              <div class="card-body" id="broadcast-history" style="flex:1;overflow-y:auto;">
                <div style="font-size:12px;color:var(--text-muted);">暂未发送广播</div>
              </div>
            </div>
            <div class="card">
              <div class="card-body" id="client-info" style="text-align:center;">
                <div class="client-count-value" id="bc-client-count">0</div>
                <div style="font-size:12px;color:var(--text-tertiary);">个活跃连接</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Bind buttons
    document.getElementById('broadcast-send-btn').addEventListener('click', sendBroadcast);
    document.getElementById('refresh-history-btn').addEventListener('click', loadHistory);
    document.getElementById('ev-pause-btn').addEventListener('click', togglePause);
    document.getElementById('ev-clear-btn').addEventListener('click', clearEvents);

    // Filter chips
    document.querySelectorAll('.ev-filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        activeFilter = chip.dataset.filter;
        // Update chip active state
        document.querySelectorAll('.ev-filter-chip').forEach(c => {
          c.classList.toggle('active', c.dataset.filter === activeFilter);
        });
        renderEventStream();
      });
    });

    // Clean up previous listeners
    _wsUnsubs.forEach(fn => fn());
    _wsUnsubs = [];

    // Listen to all system events
    listenAllEvents();

    // Also listen to broadcast + client.count for the right panel
    _listeners['broadcast'] = onIncomingBroadcast;
    _wsUnsubs.push(WS.on('broadcast', onIncomingBroadcast));
    _listeners['client.count_panel'] = onClientCount;
    _wsUnsubs.push(WS.on('client.count', onClientCount));

    // Listen for WebSocket reconnection to refresh data
    window.addEventListener('ws:reconnected', _onReconnect);

    await Promise.all([loadHistory(), loadClients()]);
    renderEventStream();
  }

  // ── Event Listening ──

  function listenAllEvents() {
    SYSTEM_EVENT_TYPES.forEach(type => {
      const handler = (payload) => onSystemEvent(type, payload);
      _listeners[type] = handler;
      _wsUnsubs.push(WS.on(type, handler));
    });
  }

  function unlistenAllEvents() {
    SYSTEM_EVENT_TYPES.forEach(type => {
      if (_listeners[type]) {
        WS.off(type, _listeners[type]);
        delete _listeners[type];
      }
    });
    // Also remove the broadcast and client.count panel listeners
    if (_listeners['broadcast']) {
      WS.off('broadcast', _listeners['broadcast']);
      delete _listeners['broadcast'];
    }
    if (_listeners['client.count_panel']) {
      WS.off('client.count', _listeners['client.count_panel']);
      delete _listeners['client.count_panel'];
    }
  }

  function onSystemEvent(type, payload) {
    const event = { type, payload, time: new Date().toISOString() };

    // claude.stream throttling: buffer non-complete chunks
    if (type === 'claude.stream' && !payload.isComplete) {
      _streamBuffer.push(event);
      const now = Date.now();
      if (now - _lastStreamRender < 150) return; // throttle
      _lastStreamRender = now;
      // Merge buffer into a single summary event
      const merged = {
        type: 'claude.stream',
        payload: {
          ...payload,
          chunk: _streamBuffer.map(e => e.payload.chunk).join('')
        },
        time: new Date().toISOString()
      };
      _streamBuffer = [];
      // Replace last stream event in list if it was also buffered
      if (systemEvents.length > 0 && systemEvents[0].type === 'claude.stream' && !systemEvents[0].payload.isComplete) {
        systemEvents[0] = merged;
      } else {
        systemEvents.unshift(merged);
      }
    } else {
      // For complete stream events or non-stream events, add directly
      if (type === 'claude.stream' && payload.isComplete) {
        _streamBuffer = []; // clear buffer on complete
      }
      systemEvents.unshift(event);
    }

    // Trim to max
    if (systemEvents.length > MAX_EVENTS) {
      systemEvents = systemEvents.slice(0, MAX_EVENTS);
    }

    // Update count badge
    const countEl = document.getElementById('ev-count');
    if (countEl) countEl.textContent = `${systemEvents.length} 条`;

    // Re-render event stream if not paused
    if (!paused) renderEventStream();
  }

  // ── Render Event Stream ──

  function renderEventStream() {
    const container = document.getElementById('event-stream');
    if (!container) return;

    // Filter events
    let filtered = systemEvents;
    const filterCfg = FILTER_MAP[activeFilter];
    if (filterCfg && filterCfg.types) {
      filtered = systemEvents.filter(e => filterCfg.types.includes(e.type));
    }

    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state" style="padding:16px;"><div class="empty-desc">暂无${filterCfg ? filterCfg.label : ''}事件</div></div>`;
      return;
    }

    container.innerHTML = filtered.map(evt => {
      const cat = getEventCategory(evt.type);
      const style = EVENT_STYLES[cat];
      const summary = formatEventSummary(evt.type, evt.payload);
      const timeStr = new Date(evt.time).toLocaleTimeString();
      const isStream = evt.type === 'claude.stream';

      return `
        <div class="event-item">
          <span style="color:${style.color};font-size:12px;flex-shrink:0;line-height:1.4;">${style.icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;gap:6px;align-items:baseline;">
              <span style="font-size:11px;font-weight:600;color:${style.color};">${style.label}</span>
              <span style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">${timeStr}</span>
            </div>
            <div style="font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${isStream ? 'font-family:var(--font-mono);font-size:11px;color:var(--accent-amber);' : ''}">${escapeHtml(summary)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── Controls ──

  function togglePause() {
    paused = !paused;
    const btn = document.getElementById('ev-pause-btn');
    if (btn) {
      btn.innerHTML = paused ? Icon.svg('play', 14) + ' 继续' : Icon.svg('pause', 14) + ' 暂停';
      btn.className = paused ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary';
    }
  }

  function clearEvents() {
    systemEvents = [];
    _streamBuffer = [];
    renderEventStream();
    const countEl = document.getElementById('ev-count');
    if (countEl) countEl.textContent = '0 条';
  }

  // ── Manual Broadcast ──

  async function sendBroadcast() {
    const msg = document.getElementById('broadcast-msg')?.value.trim();
    const type = document.getElementById('broadcast-type')?.value;
    if (!msg) {
      Toast.warning('消息内容为必填项');
      return;
    }
    try {
      await API.broadcast(msg, type);
      Toast.success('广播已发送');
      document.getElementById('broadcast-msg').value = '';
      await loadHistory();
    } catch (e) {
      Toast.error(e.message);
    }
  }

  async function loadHistory() {
    try {
      const res = await API.getBroadcastHistory();
      manualHistory = Array.isArray(res.data) ? res.data : [];
      renderHistory();
    } catch (e) {
      Toast.error('加载广播历史失败: ' + (e.message || '未知错误'));
    }
  }

  async function loadClients() {
    try {
      const res = await API.getClients();
      const countEl = document.getElementById('bc-client-count');
      if (countEl) countEl.textContent = res.data?.count || 0;
    } catch (e) {
      Toast.error('加载客户端信息失败: ' + (e.message || '未知错误'));
    }
  }

  function renderHistory() {
    const container = document.getElementById('broadcast-history');
    if (!container) return;

    if (manualHistory.length === 0) {
      container.innerHTML = EmptyState.render({ icon: Icon.svg('broadcast', 32), title: '暂未发送广播', description: '使用左侧表单发送广播消息' });
      return;
    }

    container.innerHTML = manualHistory.map(b => `
      <div class="broadcast-history-item">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span class="badge badge-${b.type || 'info'}">${b.type || 'info'}</span>
          <span style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">${new Date(b.timestamp).toLocaleString()}</span>
        </div>
        <div style="font-size:13px;color:var(--text-secondary);">${escapeHtml(b.message)}</div>
      </div>
    `).join('');
  }

  function onIncomingBroadcast(payload) {
    Toast.show(`[广播] ${payload.message}`, payload.type || 'info', 5000);
  }

  function onClientCount(payload) {
    const el = document.getElementById('bc-client-count');
    if (el) el.textContent = payload.count;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function _onReconnect() {
    console.log('[BroadcastPage] WebSocket reconnected, refreshing data...');
    loadHistory();
    loadClients();
  }

  function cleanup() {
    _wsUnsubs.forEach(fn => fn());
    _wsUnsubs = [];
    window.removeEventListener('ws:reconnected', _onReconnect);
    unlistenAllEvents();
    _listeners = {};
    _streamBuffer = [];
  }

  return { render, cleanup };
})();
