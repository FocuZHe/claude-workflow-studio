"use strict";
// ═══════════════════════════════════════════════
// Dashboard Page — Claude Workflow Studio
// ═══════════════════════════════════════════════
window.DashboardPage = (() => {
    async function render() {
        const el = document.getElementById('content');
        if (!el)
            return;
        el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">${Icon.svg('dashboard', 20)}</span> 控制台</h1>
          <div id="claude-status" style="display:flex;align-items:center;gap:8px;font-size:12px;font-family:var(--font-mono);">
            <span class="spinner spinner-sm"></span> 检查运行环境...
          </div>
        </div>
        <div class="info-banner">
          <div style="font-size:14px;font-weight:600;color:var(--accent-cyan);margin-bottom:4px;">Claude Workflow Studio</div>
          <div style="font-size:13px;color:var(--text-secondary);">通过拖拽式工作流编排多 Agent 协作，支持并行/串行执行、断点续传、Agent 记忆、知识库和技能管理。</div>
        </div>
        <div class="stats-grid" id="stats-grid">
          ${renderStatCard('agents', '--', '智能体', 'cyan')}
          ${renderStatCard('workflow', '--', '活跃工作流', 'amber')}
          ${renderStatCard('tasks', '--', '待处理任务', 'green')}
          ${renderStatCard('chat', '--', '发起对话', 'purple')}
          ${renderStatCard('terminal', '--', '开启终端', 'pink')}
        </div>
        <div class="grid-2 mt-6">
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">近期活动</h3>
            </div>
            <div class="card-body" id="activity-list">
              <div class="text-muted" style="font-size:13px;">暂无近期活动</div>
            </div>
          </div>
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">快捷操作</h3>
            </div>
            <div class="card-body" style="display:flex;flex-direction:column;gap:var(--space-3);">
              <button class="btn btn-primary" onclick="Router.navigate('/agents')">+ 创建智能体</button>
              <button class="btn btn-secondary" onclick="Router.navigate('/workflows')">${Icon.svg('workflow', 16)} 构建工作流</button>
              <button class="btn btn-secondary" onclick="Router.navigate('/tasks')">${Icon.svg('tasks', 16)} 提交任务</button>
              <button class="btn btn-secondary" onclick="Router.navigate('/files')">${Icon.svg('files', 16)} 管理项目文件</button>
              <button class="btn btn-secondary" onclick="Router.navigate('/broadcast')">${Icon.svg('broadcast', 16)} 广播消息</button>
            </div>
          </div>
        </div>

        <div class="grid-2 mt-6">
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">系统资源</h3>
              <button class="btn btn-sm btn-ghost" id="resource-refresh-btn" title="刷新">${Icon.svg('refresh', 16)}</button>
            </div>
            <div class="card-body" id="resource-monitor">
              <div class="text-muted" style="font-size:13px;">加载中...</div>
            </div>
          </div>
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Agent 进程</h3>
            </div>
            <div class="card-body" id="agent-process-list">
              <div class="text-muted" style="font-size:13px;">加载中...</div>
            </div>
          </div>
        </div>
      </div>
    `;
        // Bind buttons immediately (don't wait for async calls)
        setTimeout(() => {
            const resRefreshBtn = document.getElementById('resource-refresh-btn');
            if (resRefreshBtn)
                resRefreshBtn.addEventListener('click', () => loadResources());
        }, 0);
        _bindRealtimeUpdates();
        // Load data async
        loadStats().catch((e) => { Toast.error('加载统计数据失败: ' + (e.message || e)); });
        checkClaudeStatus().catch(() => { });
        loadResources().catch((e) => { Toast.error('加载资源信息失败: ' + (e.message || e)); });
        // 系统资源每5秒刷新一次
        _resourceRefreshTimer = setInterval(() => loadResources(), 5000);
    }
    // Icon mapping for stat cards
    const ICONS = {
        agents: Icon.svg('agents', 32),
        workflow: Icon.svg('workflow', 32),
        tasks: Icon.svg('tasks', 32),
        chat: Icon.svg('chat', 32),
        terminal: Icon.svg('terminal', 32),
    };
    function renderStatCard(key, value, label, color) {
        return `
      <div class="stat-card hover-lift" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:var(--space-2);">
        ${ICONS[key] || Icon.svg('agents', 32)}
        <div class="stat-value" data-stat="${label}">${value}</div>
        <div class="stat-label">${label}</div>
      </div>
    `;
    }
    // 数字跳动动画
    function animateNumber(el, target) {
        const raw = el.textContent.trim();
        const current = raw === '--' || raw === '' ? 0 : (parseInt(raw) || 0);
        if (current === target && raw !== '--' && raw !== '')
            return;
        const duration = 400;
        const start = performance.now();
        function tick(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
            el.textContent = String(Math.round(current + (target - current) * eased));
            if (progress < 1)
                requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }
    let _serverStartTime = 0;
    let _uptimeInterval = null;
    let _cliOk = false, _sdkOk = false;
    function startUptimeClock(statusEl) {
        if (_uptimeInterval)
            clearInterval(_uptimeInterval);
        _uptimeInterval = setInterval(() => {
            if (!statusEl || !statusEl.parentNode) {
                clearInterval(_uptimeInterval);
                return;
            }
            const uptime = Math.floor((Date.now() - _serverStartTime) / 1000);
            let extra = '';
            if (!_cliOk)
                extra += `<span style="color:var(--accent-amber);margin-left:8px;font-size:11px;">CLI ✗</span>`;
            if (!_sdkOk)
                extra += `<span style="color:var(--accent-amber);margin-left:4px;font-size:11px;">SDK ✗</span>`;
            statusEl.innerHTML = `
        <span style="color:var(--accent-green);">●</span>
        <span style="color:var(--text-secondary);">在线 ${uptime}s</span>${extra}
      `;
        }, 1000);
    }
    async function checkClaudeStatus() {
        const statusEl = document.getElementById('claude-status');
        if (!statusEl)
            return;
        const timer = setTimeout(() => {
            statusEl.innerHTML = `<span style="color:var(--accent-red);">●</span> <span style="color:var(--text-secondary);">服务器离线</span>`;
        }, 5000);
        try {
            const data = await API.get('/health');
            clearTimeout(timer);
            if (data && data.success) {
                const d = data.data;
                _cliOk = d.cli?.available || false;
                _sdkOk = d.sdk?.configured || false;
                _serverStartTime = Date.now() - (d.uptime * 1000);
                startUptimeClock(statusEl);
            }
            else {
                statusEl.innerHTML = `<span style="color:var(--accent-amber);">●</span> <span style="color:var(--text-secondary);">服务异常</span>`;
            }
        }
        catch (e) {
            clearTimeout(timer);
            statusEl.innerHTML = `<span style="color:var(--accent-red);">●</span> <span style="color:var(--text-secondary);">服务器离线</span>`;
        }
    }
    async function loadStats() {
        try {
            const [agentsRes, workflowsRes, tasksRes, chatRes, termRes] = await Promise.all([
                API.getAgents().catch(() => ({ data: [] })),
                API.getWorkflows().catch(() => ({ data: [] })),
                API.getTasks().catch(() => ({ data: [] })),
                API.getChatSessions({ limit: 100, page: 1, status: 'active' }).catch(() => ({ data: { items: [], total: 0 } })),
                API.getTerminals().catch(() => ({ data: [] })),
            ]);
            const agents = Array.isArray(agentsRes.data) ? agentsRes.data : (agentsRes.data?.items || []);
            const workflows = Array.isArray(workflowsRes.data) ? workflowsRes.data : (workflowsRes.data?.items || []);
            const tasks = Array.isArray(tasksRes.data) ? tasksRes.data : (tasksRes.data?.items || []);
            const chatData = chatRes.data || {};
            const chatCount = typeof chatData.total === 'number' ? chatData.total : (chatData.items ? chatData.items.length : 0);
            const termCount = Array.isArray(termRes.data) ? termRes.data.length : 0;
            const agentStat = document.querySelector('.stat-value[data-stat="智能体"]');
            const workflowStat = document.querySelector('.stat-value[data-stat="活跃工作流"]');
            const taskStat = document.querySelector('.stat-value[data-stat="待处理任务"]');
            const chatStat = document.querySelector('.stat-value[data-stat="发起对话"]');
            const termStat = document.querySelector('.stat-value[data-stat="开启终端"]');
            if (agentStat)
                animateNumber(agentStat, agents.length);
            if (workflowStat)
                animateNumber(workflowStat, workflows.filter((w) => w.status === 'running').length);
            if (taskStat)
                animateNumber(taskStat, tasks.filter((t) => t.status === 'pending').length);
            if (chatStat)
                animateNumber(chatStat, chatCount);
            if (termStat)
                animateNumber(termStat, termCount);
            // Recent activity
            const activities = [];
            agents.slice(-3).forEach((a) => activities.push({ text: `智能体 "${a.name}" (${a.role}) 已创建`, time: a.createdAt }));
            tasks.filter((t) => t.status === 'completed').slice(-3).forEach((t) => activities.push({ text: `任务 "${t.title}" 已完成`, time: t.completedAt }));
            tasks.filter((t) => t.status === 'running').slice(-2).forEach((t) => activities.push({ text: `任务 "${t.title}" 运行中...`, time: t.startedAt }));
            activities.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
            const actEl = document.getElementById('activity-list');
            if (actEl && activities.length > 0) {
                actEl.innerHTML = activities.slice(0, 8).map((a) => `
          <div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--border-subtle);font-size:13px;">
            <span style="color:var(--text-secondary);">${escapeHtml(a.text)}</span>
            <span style="color:var(--text-muted);font-size:11px;font-family:var(--font-mono);white-space:nowrap;margin-left:8px;">${a.time ? new Date(a.time).toLocaleString() : ''}</span>
          </div>
        `).join('');
            }
        }
        catch (e) {
            console.error('Dashboard load error:', e);
            Toast.error('加载统计数据失败');
        }
    }
    async function loadResources() {
        try {
            const [resRes, agentRes] = await Promise.all([
                API.getResources(),
                API.getAgentResources()
            ]);
            const res = resRes?.data;
            const monitor = document.getElementById('resource-monitor');
            if (monitor && res) {
                const cpuPct = res.cpu?.usage ?? 0;
                const memPct = res.memory?.usagePercent ?? 0;
                const memUsed = res.memory?.used ? (res.memory.used / 1024 / 1024 / 1024).toFixed(1) : '--';
                const memTotal = res.memory?.total ? (res.memory.total / 1024 / 1024 / 1024).toFixed(1) : '--';
                const uptime = res.uptime ? Math.floor(res.uptime / 60) : 0;
                monitor.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:12px;">
            ${renderResourceBar('CPU', cpuPct, `${res.cpu?.cores || '--'} 核 ${res.cpu?.model || ''}`)}
            ${renderResourceBar('内存', memPct, `${memUsed} / ${memTotal} GB`)}
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);">
              <span>运行时间: ${uptime} 分钟</span>
              <span>平台: ${res.platform || '--'}</span>
            </div>
          </div>
        `;
            }
            const agentList = document.getElementById('agent-process-list');
            const agents = agentRes?.data;
            if (agentList) {
                if (!agents || agents.length === 0) {
                    agentList.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:20px;">暂无运行中的 Agent 进程</div>';
                }
                else {
                    agentList.innerHTML = agents.map((a) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-subtle);font-size:12px;">
              <span style="font-family:var(--font-mono);">${escapeHtml(a.name || a.pid || '--')}</span>
              <span style="color:var(--text-muted);">PID: ${a.pid || '--'}</span>
            </div>
          `).join('');
                }
            }
        }
        catch (e) {
            console.warn('加载资源信息失败:', e.message);
            Toast.error('加载资源信息失败: ' + (e.message || e));
        }
    }
    function renderResourceBar(label, pct, detail) {
        const color = pct > 80 ? 'var(--accent-red)' : pct > 60 ? 'var(--accent-amber)' : 'var(--accent-green)';
        return `
      <div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:var(--space-1);">
          <span style="font-weight:600;">${label}</span>
          <span style="color:var(--text-muted);">${pct.toFixed(1)}%</span>
        </div>
        <div style="height:6px;background:var(--bg-deep);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${Math.min(pct, 100)}%;background:${color};border-radius:3px;transition:width 0.5s;"></div>
        </div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:var(--space-1);">${detail}</div>
      </div>
    `;
    }
    // ── WebSocket real-time updates ──
    let _refreshTimer = null;
    let _resourceRefreshTimer = null;
    const _wsCleanups = [];
    function _bindRealtimeUpdates() {
        // Throttled loadStats to avoid excessive API calls during rapid WS events
        const throttledLoadStats = throttle(loadStats, 2000);
        // Refresh stats on task events
        _wsCleanups.push(WS.on('task.completed', throttledLoadStats));
        _wsCleanups.push(WS.on('task.failed', throttledLoadStats));
        _wsCleanups.push(WS.on('task.progress', throttledLoadStats));
        _wsCleanups.push(WS.on('task.created', throttledLoadStats));
        _wsCleanups.push(WS.on('task.updated', throttledLoadStats));
        _wsCleanups.push(WS.on('task.deleted', throttledLoadStats));
        // Refresh on workflow status changes
        _wsCleanups.push(WS.on('workflow.statusUpdate', throttledLoadStats));
        _wsCleanups.push(WS.on('workflow.nodeUpdate', throttledLoadStats));
        _wsCleanups.push(WS.on('workflow.created', throttledLoadStats));
        _wsCleanups.push(WS.on('workflow.updated', throttledLoadStats));
        _wsCleanups.push(WS.on('workflow.deleted', throttledLoadStats));
        // Refresh on agent status changes
        _wsCleanups.push(WS.on('agent.statusUpdate', throttledLoadStats));
        _wsCleanups.push(WS.on('agent.created', throttledLoadStats));
        _wsCleanups.push(WS.on('agent.updated', throttledLoadStats));
        _wsCleanups.push(WS.on('agent.deleted', throttledLoadStats));
        // Refresh on chat activity (create/delete sessions)
        _wsCleanups.push(WS.on('chat.titleUpdated', throttledLoadStats));
        _wsCleanups.push(WS.on('chat.stream', throttledLoadStats));
        // Listen for WebSocket reconnection to refresh data
        window.addEventListener('ws:reconnected', _onReconnect);
        // Periodic refresh every 15s as fallback
        _refreshTimer = setInterval(() => loadStats(), 15000);
    }
    function _onReconnect() {
        console.log('[DashboardPage] WebSocket reconnected, refreshing data...');
        loadStats();
    }
    function cleanup() {
        _wsCleanups.forEach((fn) => fn());
        _wsCleanups.length = 0;
        window.removeEventListener('ws:reconnected', _onReconnect);
        if (_refreshTimer) {
            clearInterval(_refreshTimer);
            _refreshTimer = null;
        }
        if (_resourceRefreshTimer) {
            clearInterval(_resourceRefreshTimer);
            _resourceRefreshTimer = null;
        }
        if (_uptimeInterval) {
            clearInterval(_uptimeInterval);
            _uptimeInterval = null;
        }
    }
    return { render, cleanup };
})();
