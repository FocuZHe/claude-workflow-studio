// ═══════════════════════════════════════════════
// Terminal Panel — Global bottom panel (xterm.js)
// ═══════════════════════════════════════════════

window.TerminalPanel = (() => {
  let panel = null;
  let isOpen = false;
  let sessions = [];
  let activeSessionId = null;
  let resizeStartY = 0;
  let resizeStartHeight = 300;
  const STORAGE_KEY = 'terminal-panel-state';
  const DEFAULT_HEIGHT = 300;
  const MIN_HEIGHT = 150;
  const MAX_HEIGHT = 600;
  const MAX_SESSIONS = 10;

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved) {
        sessions = saved.sessions || [];
        activeSessionId = saved.activeSessionId || null;
        isOpen = saved.isOpen || false;
      }
    } catch (e) { /* ignore */ }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        sessions: sessions.map(s => ({ id: s.id, title: s.title, cwd: s.cwd })),
        activeSessionId,
        isOpen,
      }));
    } catch (e) { /* ignore */ }
  }

  function renderPanel() {
    if (panel) return;

    panel = document.createElement('div');
    panel.className = 'terminal-panel';
    panel.id = 'terminal-panel';
    panel.innerHTML = `
      <div class="terminal-resize-handle" id="terminal-resize-handle"></div>
      <div class="terminal-header">
        <div class="terminal-tabs" id="terminal-tabs"></div>
        <div class="terminal-header-actions">
          <button class="btn btn-sm btn-ghost" id="terminal-new-btn" title="新建会话">+ 新建</button>
          <button class="btn btn-sm btn-ghost" id="terminal-clear-btn" title="清空终端">清空</button>
          <button class="btn btn-sm btn-ghost" id="terminal-close-btn" title="关闭面板">${Icon.svg('close', 16)}</button>
        </div>
      </div>
      <div class="terminal-body" id="terminal-body">
        <div id="terminal-xterm-container" style="flex:1;overflow:hidden;"></div>
      </div>
    `;
    document.body.appendChild(panel);

    // Event bindings
    document.getElementById('terminal-new-btn').addEventListener('click', createSession);
    document.getElementById('terminal-clear-btn').addEventListener('click', clearOutput);
    document.getElementById('terminal-close-btn').addEventListener('click', toggle);

    // Resize handle
    const handle = document.getElementById('terminal-resize-handle');
    handle.addEventListener('mousedown', startResize);

    // Restore height
    const savedHeight = localStorage.getItem('terminal-panel-height');
    if (savedHeight) {
      panel.style.height = savedHeight + 'px';
    }
  }

  function renderTabs() {
    const tabsEl = document.getElementById('terminal-tabs');
    if (!tabsEl) return;

    if (sessions.length === 0) {
      tabsEl.innerHTML = '<span style="font-size:var(--text-xs);color:var(--text-muted);padding:4px 8px;">无会话</span>';
      return;
    }

    tabsEl.innerHTML = sessions.map(s => `
      <button class="terminal-tab ${s.id === activeSessionId ? 'active' : ''}" data-id="${s.id}">
        <span>${escapeHtml(s.title || '会话')}</span>
        <button class="terminal-tab-close" data-id="${s.id}" title="关闭">${Icon.svg('close', 14)}</button>
      </button>
    `).join('');

    tabsEl.querySelectorAll('.terminal-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        if (e.target.classList.contains('terminal-tab-close')) return;
        switchSession(tab.dataset.id);
      });
    });

    tabsEl.querySelectorAll('.terminal-tab-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSession(btn.dataset.id);
      });
    });
  }

  function getActiveSession() {
    return sessions.find(s => s.id === activeSessionId);
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
      } catch (e) { /* ignore, use default */ }

      const res = await API.createTerminal(cwd);
      const session = {
        id: res.data?.id || ('term-' + Date.now()),
        title: '会话 ' + (sessions.length + 1),
        cwd: res.data?.cwd || cwd || '',
        isHistorical: false,
      };
      sessions.push(session);
      activeSessionId = session.id;
      renderTabs();
      switchSession(session.id);
      saveState();
      Toast.success('终端会话已创建');
    } catch (e) {
      Toast.error('创建终端失败: ' + e.message);
    }
  }

  function switchSession(id) {
    activeSessionId = id;
    const session = getActiveSession();
    if (!session) return;

    const container = document.getElementById('terminal-xterm-container');
    if (!container) return;

    // Clear and attach terminal
    container.innerHTML = '';
    XtermTerminal.create(id, container);

    // Register input handler if session is live
    if (!session.isHistorical) {
      XtermTerminal.onInput(id, async (data) => {
        try {
          await API.sendTerminalInput(id, data);
        } catch (e) {
          console.warn('[TerminalPanel] send input failed:', e.message);
        }
      });

      // Fetch and replay saved output for restored sessions
      API.getTerminalOutput(id).then(res => {
        if (res?.data?.output) {
          XtermTerminal.write(id, res.data.output);
        }
      }).catch(() => {});
    }

    requestAnimationFrame(() => XtermTerminal.fit(id));
    XtermTerminal.focus(id);

    renderTabs();
    saveState();
  }

  async function closeSession(id) {
    const session = sessions.find(s => s.id === id);
    if (!session) return;

    if (!session.isHistorical) {
      const confirmed = await ConfirmDialog.show({
        title: '关闭终端会话',
        message: `确定要关闭 "${session.title}" 吗？终端进程将被终止。`,
        confirmText: '关闭',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await API.killTerminal(id);
      } catch (e) { /* ignore */ }
    }

    XtermTerminal.destroy(id);
    sessions = sessions.filter(s => s.id !== id);
    if (activeSessionId === id) {
      activeSessionId = sessions.length > 0 ? sessions[0].id : null;
    }
    renderTabs();
    if (activeSessionId) {
      switchSession(activeSessionId);
    } else {
      const container = document.getElementById('terminal-xterm-container');
      if (container) container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">无活动会话</div>';
    }
    saveState();
  }

  function clearOutput() {
    const session = getActiveSession();
    if (session) {
      XtermTerminal.clear(session.id);
    }
  }

  // Resize
  function startResize(e) {
    e.preventDefault();
    resizeStartY = e.clientY;
    resizeStartHeight = panel.offsetHeight;
    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);
  }

  function doResize(e) {
    const delta = resizeStartY - e.clientY;
    const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, resizeStartHeight + delta));
    panel.style.height = newHeight + 'px';
    XtermTerminal.fitAll();
  }

  function stopResize() {
    document.removeEventListener('mousemove', doResize);
    document.removeEventListener('mouseup', stopResize);
    localStorage.setItem('terminal-panel-height', panel.offsetHeight);
  }

  function applySidebarState() {
    if (!panel) return;
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('collapsed')) {
      panel.classList.add('sidebar-collapsed');
    } else {
      panel.classList.remove('sidebar-collapsed');
    }
  }

  function openPanel() {
    if (!panel) renderPanel();
    panel.offsetHeight; // force reflow
    panel.classList.add('open');
    isOpen = true;
    applySidebarState();
    renderTabs();
    if (activeSessionId) switchSession(activeSessionId);
    saveState();
    // Fit after panel is visible
    setTimeout(() => XtermTerminal.fitAll(), 50);
  }

  function closePanel() {
    if (panel) {
      panel.classList.remove('open');
    }
    isOpen = false;
    saveState();
  }

  function toggle() {
    if (isOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function init() {
    loadState();
    renderPanel();

    // WebSocket listener for terminal output
    WS.on('terminal.output', (payload) => {
      XtermTerminal.write(payload.sessionId, payload.data);
    });

    WS.on('terminal.exit', (payload) => {
      const session = sessions.find(s => s.id === payload.sessionId);
      if (session) {
        session.isHistorical = true;
        XtermTerminal.write(payload.sessionId, `\r\n\x1b[33m[进程已退出，代码: ${payload.code || 0}]\x1b[0m\r\n`);
      }
    });

    // Ctrl+` shortcut
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        toggle();
      }
    });

    // If it was open before, reopen
    if (isOpen) {
      openPanel();
    }

    // Listen for sidebar collapse changes
    const observer = new MutationObserver(() => applySidebarState());
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      observer.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
    }

    // Window resize
    window.addEventListener('resize', () => {
      if (isOpen) XtermTerminal.fitAll();
    });
  }

  return { init, toggle, openPanel, closePanel };
})();
