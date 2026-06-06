"use strict";
// ═══════════════════════════════════════════════
// Terminal Page — Standalone terminal with session list (xterm.js)
// ═══════════════════════════════════════════════
window.TerminalPage = (() => {
    let sessions = [];
    let activeSessionId = null;
    let _cleanupFns = [];
    let _pollTimer = null;
    const STORAGE_KEY = 'terminal-sessions';
    const MAX_HISTORY = 100;
    const MAX_SESSIONS = 10;
    let commandHistory = [];
    let historyIndex = -1;
    function loadState() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (saved) {
                sessions = saved.sessions || [];
                activeSessionId = saved.activeSessionId || null;
                sessions.forEach(s => { s.isHistorical = true; });
            }
        }
        catch (e) { /* ignore */ }
        try {
            commandHistory = JSON.parse(localStorage.getItem('terminal-cmd-history')) || [];
        }
        catch (e) {
            commandHistory = [];
        }
    }
    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                sessions: sessions.map(s => ({
                    id: s.id,
                    title: s.title,
                    cwd: s.cwd,
                    createdAt: s.createdAt,
                    isHistorical: s.isHistorical,
                })),
                activeSessionId,
            }));
        }
        catch (e) { /* ignore */ }
    }
    function saveHistory() {
        try {
            localStorage.setItem('terminal-cmd-history', JSON.stringify(commandHistory.slice(-MAX_HISTORY)));
        }
        catch (e) { /* ignore */ }
    }
    function getActiveSession() {
        return sessions.find(s => s.id === activeSessionId);
    }
    async function render() {
        const el = document.getElementById('content');
        el.innerHTML = `
      <div class="terminal-page-wrapper">
        <div class="page-header" style="flex-shrink:0;">
          <h1 class="page-title"><span class="page-icon">${Icon.svg('terminal', 20)}</span> 终端</h1>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-secondary" id="term-new-btn">+ 新建会话</button>
            <button class="btn btn-secondary" id="term-clear-btn">清空</button>
            <button class="btn btn-sm btn-secondary" id="terminal-history-btn">历史</button>
          </div>
        </div>
        <div class="terminal-page-container">
          <!-- Session list sidebar -->
          <div class="terminal-sidebar">
            <div style="padding:8px;border-bottom:1px solid var(--border-subtle);">
              <input class="input" id="term-search" placeholder="搜索会话..." style="font-size:12px;padding:6px 10px;">
            </div>
            <div id="term-session-list" style="flex:1;overflow-y:auto;"></div>
          </div>
          <!-- Terminal area -->
          <div class="terminal-main">
            <div id="term-xterm-container" style="flex:1;overflow:hidden;"></div>
          </div>
        </div>
      </div>
    `;
        // Event bindings
        document.getElementById('term-new-btn').addEventListener('click', createSession);
        document.getElementById('term-clear-btn').addEventListener('click', clearOutput);
        document.getElementById('term-search').addEventListener('input', debounce(filterSessions, 300));
        document.getElementById('terminal-history-btn')?.addEventListener('click', showTerminalHistory);
        // Load saved sessions
        loadState();
        // Restore session list
        renderSessionList();
        // Try to restore sessions: first check live server sessions, then restore saved ones
        try {
            const res = await API.getTerminals();
            const liveSessions = res.data || [];
            if (liveSessions.length > 0) {
                // Server has live sessions — use them
                liveSessions.forEach(ls => {
                    const existing = sessions.find(s => s.id === ls.id);
                    if (!existing) {
                        sessions.push({
                            id: ls.id,
                            title: ls.title || '会话 ' + (sessions.length + 1),
                            cwd: ls.cwd || '',
                            isHistorical: false,
                            createdAt: ls.createdAt || Date.now(),
                        });
                    }
                    else {
                        existing.isHistorical = false;
                    }
                });
            }
            else if (sessions.length > 0) {
                // Server has no live sessions — restore from saved state
                const toRestore = sessions;
                if (toRestore.length > 0) {
                    try {
                        const restoreRes = await API.restoreTerminals(toRestore.map(s => ({ title: s.title, cwd: s.cwd })));
                        const restored = restoreRes.data || [];
                        // Replace saved sessions with restored ones
                        sessions = restored.map((rs, i) => ({
                            id: rs.id,
                            title: toRestore[i]?.title || rs.title || '终端 ' + (i + 1),
                            cwd: rs.cwd || '',
                            isHistorical: false,
                            createdAt: Date.now(),
                        }));
                    }
                    catch (e) {
                        console.warn('[TerminalPage] 恢复终端会话失败:', e.message);
                        // Mark all as historical since server sessions are gone
                        sessions.forEach(s => { s.isHistorical = true; });
                    }
                }
            }
            if (!activeSessionId && sessions.length > 0) {
                activeSessionId = sessions[0].id;
            }
            renderSessionList();
            if (activeSessionId)
                switchSession(activeSessionId);
            saveState();
        }
        catch (e) {
            console.warn('[TerminalPage] 获取终端列表失败:', e.message);
        }
        // WebSocket listeners
        const outputHandler = (payload) => {
            XtermTerminal.write(payload.sessionId, payload.data);
        };
        WS.on('terminal.output', outputHandler);
        _cleanupFns.push(() => WS.off('terminal.output', outputHandler));
        const exitHandler = (payload) => {
            const session = sessions.find(s => s.id === payload.sessionId);
            if (session) {
                session.isHistorical = true;
                XtermTerminal.write(payload.sessionId, `\r\n\x1b[33m[进程已退出，代码: ${payload.code || 0}]\x1b[0m\r\n`);
                if (session.id === activeSessionId)
                    renderSessionList();
                saveState();
            }
        };
        WS.on('terminal.exit', exitHandler);
        _cleanupFns.push(() => WS.off('terminal.exit', exitHandler));
        // Resize handler
        const resizeHandler = debounce(() => XtermTerminal.fitAll(), 200);
        window.addEventListener('resize', resizeHandler);
        _cleanupFns.push(() => window.removeEventListener('resize', resizeHandler));
    }
    function cleanup() {
        if (_pollTimer) {
            clearInterval(_pollTimer);
            _pollTimer = null;
        }
        _cleanupFns.forEach(fn => fn());
        _cleanupFns = [];
        XtermTerminal.destroyAll();
    }
    function renderSessionList(list) {
        const container = document.getElementById('term-session-list');
        if (!container)
            return;
        const items = list || sessions;
        if (items.length === 0) {
            container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px;">暂无会话</div>';
            return;
        }
        container.innerHTML = items.map(s => {
            const isActive = s.id === activeSessionId;
            return `
        <div class="term-session-item ${isActive ? 'active' : ''}" data-id="${s.id}" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border-subtle);transition:background 0.15s;position:relative;${isActive ? 'background:var(--bg-primary);border-left:3px solid var(--accent-cyan);' : 'border-left:3px solid transparent;'}">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary);flex:1;cursor:text;">
              <span class="term-session-title" data-id="${s.id}" title="点击重命名">${escapeHtml(s.title || '会话')}</span>
              ${s.isHistorical ? '<span style="font-size:10px;color:var(--text-tertiary);margin-left:4px;">[历史]</span>' : ''}
            </div>
            <button class="term-session-delete" data-id="${s.id}" title="关闭会话" style="flex-shrink:0;width:20px;height:20px;border:none;background:transparent;color:var(--text-tertiary);cursor:pointer;font-size:14px;line-height:20px;text-align:center;border-radius:4px;opacity:0;transition:opacity 0.15s,background 0.15s;padding:0;">✕</button>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.cwd || '')}</div>
          <div style="font-size:10px;color:var(--text-tertiary);margin-top:2px;">${formatDate(s.createdAt)}</div>
        </div>
      `;
        }).join('');
        container.querySelectorAll('.term-session-item').forEach(el => {
            el.addEventListener('click', () => switchSession(el.dataset.id));
            el.addEventListener('mouseenter', () => {
                if (el.dataset.id !== activeSessionId)
                    el.style.background = 'var(--bg-secondary)';
                const delBtn = el.querySelector('.term-session-delete');
                if (delBtn)
                    delBtn.style.opacity = '1';
            });
            el.addEventListener('mouseleave', () => {
                if (el.dataset.id !== activeSessionId)
                    el.style.background = '';
                const delBtn = el.querySelector('.term-session-delete');
                if (delBtn)
                    delBtn.style.opacity = '0';
            });
        });
        container.querySelectorAll('.term-session-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await closeSession(btn.dataset.id);
            });
            btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,60,60,0.15)'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
        });
        // Click-to-rename session title
        container.querySelectorAll('.term-session-title').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = el.dataset.id;
                const session = sessions.find(s => s.id === id);
                if (!session)
                    return;
                const oldTitle = session.title;
                const input = document.createElement('input');
                input.type = 'text';
                input.value = oldTitle;
                input.style.cssText = 'width:100%;background:var(--bg-deep);border:1px solid var(--accent-cyan);border-radius:3px;color:var(--text-primary);font-size:13px;padding:2px 4px;outline:none;';
                el.innerHTML = '';
                el.appendChild(input);
                input.focus();
                input.select();
                const finish = (confirmed) => {
                    const val = input.value.trim() || oldTitle;
                    if (confirmed)
                        session.title = val;
                    el.innerHTML = escapeHtml(session.title);
                    saveState();
                    XtermTerminal?.renameSession?.(id, session.title);
                };
                input.addEventListener('blur', () => finish(true));
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        finish(true);
                    }
                    if (ev.key === 'Escape') {
                        ev.preventDefault();
                        finish(false);
                    }
                });
            });
        });
    }
    function filterSessions() {
        const query = document.getElementById('term-search')?.value?.toLowerCase() || '';
        const filtered = sessions.filter(s => (s.title || '').toLowerCase().includes(query) ||
            (s.cwd || '').toLowerCase().includes(query));
        renderSessionList(filtered);
    }
    function switchSession(id) {
        activeSessionId = id;
        const session = getActiveSession();
        if (!session)
            return;
        const container = document.getElementById('term-xterm-container');
        if (!container)
            return;
        container.innerHTML = '';
        XtermTerminal.create(id, container);
        // 输入直接写入 PTY（输出通过 WebSocket terminal.output 事件推送）
        if (!session.isHistorical) {
            XtermTerminal.onInput(id, async (data) => {
                try {
                    await API.sendTerminalInput(id, data);
                }
                catch (e) {
                    console.warn('[TerminalPage] send input failed:', e.message);
                }
            });
        }
        requestAnimationFrame(() => XtermTerminal.fit(id));
        XtermTerminal.focus(id);
        saveState();
        renderSessionList();
    }
    async function createSession() {
        if (sessions.length >= MAX_SESSIONS) {
            Toast.warning(`终端会话数量已达上限（${MAX_SESSIONS} 个），请先关闭不需要的会话`);
            return;
        }
        try {
            // Get current workspace root for terminal cwd
            let cwd = undefined;
            try {
                const wsRes = await API.getWorkspaceState();
                if (wsRes.data?.state?.workspacePath) {
                    cwd = wsRes.data.state.workspacePath;
                }
            }
            catch (e) { /* ignore, use default */ }
            const res = await API.createTerminal(cwd);
            const session = {
                id: res.data?.id || ('term-' + Date.now()),
                title: '终端 ' + (sessions.length + 1),
                cwd: res.data?.cwd || cwd || '',
                isHistorical: false,
                createdAt: Date.now(),
            };
            sessions.push(session);
            activeSessionId = session.id;
            renderSessionList();
            switchSession(session.id);
            saveState();
            Toast.success('终端会话已创建');
        }
        catch (e) {
            Toast.error('创建终端失败: ' + e.message);
        }
    }
    async function closeSession(id) {
        const session = sessions.find(s => s.id === id);
        if (!session)
            return;
        if (!session.isHistorical) {
            const confirmed = await ConfirmDialog.show({
                title: '关闭终端会话',
                message: `确定要关闭 "${session.title}" 吗？终端进程将被终止。`,
                confirmText: '关闭',
                danger: true,
            });
            if (!confirmed)
                return;
            try {
                await API.killTerminal(id);
            }
            catch (e) { /* ignore */ }
        }
        XtermTerminal.destroy(id);
        sessions = sessions.filter(s => s.id !== id);
        if (activeSessionId === id) {
            activeSessionId = sessions.length > 0 ? sessions[0].id : null;
        }
        renderSessionList();
        if (activeSessionId) {
            switchSession(activeSessionId);
        }
        else {
            const container = document.getElementById('term-xterm-container');
            if (container)
                container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">无活动会话。点击"+ 新建会话"创建一个。</div>';
        }
        saveState();
    }
    function clearOutput() {
        const session = getActiveSession();
        if (session) {
            XtermTerminal.clear(session.id);
        }
    }
    async function showTerminalHistory() {
        if (!activeSessionId) {
            Toast.warning('请先选择终端会话');
            return;
        }
        try {
            const res = await API.getTerminalHistory(activeSessionId);
            const history = res.data || [];
            if (history.length === 0) {
                Toast.info('暂无命令历史');
                return;
            }
            Modal.open({
                title: '命令历史',
                body: `
          <div style="max-height:400px;overflow-y:auto;">
            ${history.map((h, i) => `
              <div class="history-item" style="padding:8px 12px;border-bottom:1px solid var(--border-subtle);cursor:pointer;font-family:var(--font-mono);font-size:12px;" data-cmd="${escapeHtml(h.command)}">
                <span style="color:var(--text-muted);margin-right:8px;">${i + 1}</span>
                <span>${escapeHtml(h.command)}</span>
                <span style="float:right;color:var(--text-tertiary);font-size:10px;">${new Date(h.timestamp).toLocaleTimeString()}</span>
              </div>
            `).join('')}
          </div>
        `,
                footer: '<button class="btn btn-secondary" onclick="Modal.close()">关闭</button>'
            });
            document.querySelectorAll('.history-item').forEach(item => {
                item.addEventListener('click', () => {
                    const cmd = item.dataset.cmd;
                    // Send command to active terminal
                    if (activeSessionId) {
                        API.sendTerminalInput(activeSessionId, cmd + '\r').catch(() => { });
                    }
                    Modal.close();
                });
            });
        }
        catch (e) {
            Toast.error('获取历史失败: ' + e.message);
        }
    }
    return { render, cleanup };
})();
