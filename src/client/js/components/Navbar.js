// ═══════════════════════════════════════════════
// Navbar Component
// ═══════════════════════════════════════════════

window.Navbar = (() => {
  const pageTitles = {
    dashboard: '控制面板',
    agents: '智能体',
    workflows: '工作流',
    tasks: '任务',
    files: '文件',
    broadcast: '广播',
    history: '历史',
    market: '市场',
    settings: '设置',
    terminal: '终端',
    chat: '对话',
  };

  let currentWorkspacePath = '';
  let dropdownOpen = false;

  function truncatePath(path, maxLen) {
    if (!path) return '未知工作区';
    maxLen = maxLen || 36;
    if (path.length <= maxLen) return path;
    return '...' + path.slice(path.length - maxLen + 3);
  }

  function render() {
    return `
      <div class="navbar-brand">
        <div class="logo-icon">C</div>
        <span>Claude Agent Studio</span>
      </div>
      <div class="navbar-title" id="page-title">控制面板</div>
      <div class="navbar-workspace" id="navbar-workspace">
        <div class="navbar-workspace-current" id="navbar-workspace-current" title="">
          <span class="navbar-workspace-icon">${Icon.svg('folder-plus', 16)}</span>
          <span class="navbar-workspace-path" id="navbar-workspace-path">加载中...</span>
        </div>
        <button class="btn btn-sm btn-secondary navbar-workspace-switch" id="navbar-workspace-switch">切换</button>
        <div class="navbar-workspace-dropdown" id="navbar-workspace-dropdown" style="display:none;">
          <div class="navbar-workspace-dropdown-header">最近使用的工作区</div>
          <div class="navbar-workspace-dropdown-list" id="navbar-workspace-dropdown-list">
            <div style="padding:12px;text-align:center;color:var(--text-muted);font-size:12px;">加载中...</div>
          </div>
          <div class="navbar-workspace-dropdown-footer" id="navbar-workspace-browse-other">浏览其他...</div>
        </div>
      </div>
      <div class="navbar-cmd-hint" id="navbar-cmd-hint" title="Ctrl+K 打开命令面板">
        <span style="font-size:12px;">${Icon.svg('search', 16)}</span>
        <span>Ctrl+K</span>
      </div>
      <div class="navbar-status">
        <button class="theme-toggle" id="theme-toggle" title="切换主题">
          <span id="theme-toggle-icon">${Icon.svg('moon', 16)}</span>
        </button>
        <div class="notification-bell" onclick="NotificationManager.togglePanel()" style="position:relative;cursor:pointer;padding:6px 10px;border-radius:var(--border-radius);transition:background 0.2s;" onmouseenter="this.style.background='var(--bg-secondary)'" onmouseleave="this.style.background='transparent'">
          <span style="font-size:18px;">${Icon.svg('bell', 18)}</span>
          <span id="notification-badge" style="display:none;position:absolute;top:2px;right:4px;background:var(--accent-red);color:#fff;font-size:10px;font-weight:700;min-width:16px;height:16px;border-radius:8px;align-items:center;justify-content:center;padding:0 4px;font-family:var(--font-mono);">0</span>
        </div>
        <div class="workspace-count" id="workspace-count" title="活跃工作区数">
          <span style="font-size:14px;">&#x229e;</span>
          <span id="active-workspace-count">0</span>
        </div>
        <div class="ws-status" id="ws-status">
          <span class="ws-dot" id="ws-dot"></span>
          <span id="ws-text">未连接</span>
        </div>
        <div class="client-count">
          <span>●</span>
          <span id="client-count">0</span> 个客户端
        </div>
      </div>
    `;
  }

  async function loadCurrentWorkspace() {
    try {
      const res = await API.getWorkspaceInfo();
      if (res?.data) {
        currentWorkspacePath = res.data.path || '';
        const pathEl = document.getElementById('navbar-workspace-path');
        const currentEl = document.getElementById('navbar-workspace-current');
        if (pathEl) {
          pathEl.textContent = currentWorkspacePath ? truncatePath(currentWorkspacePath) : '无工作区';
        }
        if (currentEl) {
          currentEl.title = currentWorkspacePath || '无工作区';
        }
      }
    } catch (e) {
      const pathEl = document.getElementById('navbar-workspace-path');
      if (pathEl) pathEl.textContent = '无工作区';
    }
  }

  async function loadRecentWorkspaces() {
    const listEl = document.getElementById('navbar-workspace-dropdown-list');
    if (!listEl) return;
    try {
      const res = await API.getWorkspaceInfo();
      const recentWorkspaces = res?.data?.recentWorkspaces || [];
      if (recentWorkspaces.length === 0) {
        listEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:12px;">暂无最近使用的工作区</div>';
        return;
      }
      listEl.innerHTML = recentWorkspaces.map(ws => {
        const wsPath = typeof ws === 'string' ? ws : ws.path;
        const wsName = typeof ws === 'string' ? '' : (ws.name || '');
        const isActive = wsPath === currentWorkspacePath;
        return `
          <div class="navbar-workspace-item ${isActive ? 'active' : ''}" data-path="${escapeAttr(wsPath)}" title="${escapeAttr(wsPath)}">
            <span class="navbar-workspace-item-icon">${isActive ? '●' : '○'}</span>
            <div class="navbar-workspace-item-info">
              <div class="navbar-workspace-item-name">${escapeHtml(wsName || truncatePath(wsPath, 30))}</div>
              <div class="navbar-workspace-item-path">${escapeHtml(truncatePath(wsPath, 40))}</div>
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.navbar-workspace-item').forEach(item => {
        item.addEventListener('click', () => switchToWorkspace(item.dataset.path));
      });
    } catch (e) {
      listEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:12px;">加载失败</div>';
    }
  }

  async function switchToWorkspace(path) {
    if (!path || path === currentWorkspacePath) {
      closeDropdown();
      return;
    }
    try {
      const res = await API.setWorkspace(path);
      Toast.success('工作区已切换');
      currentWorkspacePath = path;
      const pathEl = document.getElementById('navbar-workspace-path');
      const currentEl = document.getElementById('navbar-workspace-current');
      if (pathEl) pathEl.textContent = truncatePath(path);
      if (currentEl) currentEl.title = path;
      closeDropdown();

      // If Store exists, update it with state data from response
      if (res?.data?.state && typeof Store !== 'undefined' && Store.setState) {
        Store.setState(res.data.state);
      }

      // Notify other components about workspace change
      if (typeof WS !== 'undefined' && WS.emit) {
        WS.emit('workspace.changed', { path: path });
      }
    } catch (e) {
      Toast.error(e.message || '切换工作区失败');
    }
  }

  function openDropdown() {
    const dropdown = document.getElementById('navbar-workspace-dropdown');
    if (dropdown) {
      dropdown.style.display = 'block';
      dropdownOpen = true;
      loadRecentWorkspaces();
    }
  }

  function closeDropdown() {
    const dropdown = document.getElementById('navbar-workspace-dropdown');
    if (dropdown) {
      dropdown.style.display = 'none';
      dropdownOpen = false;
    }
  }

  function toggleDropdown() {
    if (dropdownOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function escapeAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function init() {
    const el = document.getElementById('navbar');
    el.innerHTML = render();

    // Workspace switcher events
    const switchBtn = document.getElementById('navbar-workspace-switch');
    if (switchBtn) {
      switchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown();
      });
    }

    // Click outside to close dropdown
    document.addEventListener('click', (e) => {
      const workspaceEl = document.getElementById('navbar-workspace');
      if (workspaceEl && !workspaceEl.contains(e.target)) {
        closeDropdown();
      }
    });

    // Browse other button
    const browseBtn = document.getElementById('navbar-workspace-browse-other');
    if (browseBtn) {
      browseBtn.addEventListener('click', () => {
        closeDropdown();
        if (typeof DirectoryBrowser !== 'undefined') {
          DirectoryBrowser.open({
            title: '选择工作区',
            onConfirm: async (selectedPath) => {
              await switchToWorkspace(selectedPath);
            },
          });
        }
      });
    }

    // Theme toggle
    function applyTheme(theme) {
      if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      const icon = document.getElementById('theme-toggle-icon');
      if (icon) icon.innerHTML = theme === 'light' ? Icon.svg('sun', 16) : Icon.svg('moon', 16);
    }

    const savedTheme = localStorage.getItem('theme')
      || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    applyTheme(savedTheme);

    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const current = localStorage.getItem('theme') || 'dark';
        const next = current === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', next);
        applyTheme(next);
      });
    }

    // Command palette hint
    const cmdHint = document.getElementById('navbar-cmd-hint');
    if (cmdHint) {
      cmdHint.addEventListener('click', () => {
        if (typeof CommandPalette !== 'undefined') CommandPalette.open();
      });
    }

    // Load current workspace info
    loadCurrentWorkspace();

    // Load active workspace count
    async function loadActiveWorkspaceCount() {
      try {
        const res = await API.getWorkspaces();
        const count = (res.data || []).length;
        const el = document.getElementById('active-workspace-count');
        if (el) el.textContent = count;
      } catch (e) { /* ignore */ }
    }
    loadActiveWorkspaceCount();

    // Workspace count click -> navigate to workspaces page
    const wsCountEl = document.getElementById('workspace-count');
    if (wsCountEl) {
      wsCountEl.addEventListener('click', () => {
        Router.navigate('/files');
      });
    }

    // Listen for workspace change events from other components
    if (typeof WS !== 'undefined') {
      WS.on('workspace.changed', () => {
        loadCurrentWorkspace();
        loadActiveWorkspaceCount();
      });
    }

    // WS status
    WS.on('_connected', () => {
      const dot = document.getElementById('ws-dot');
      const text = document.getElementById('ws-text');
      if (dot) { dot.classList.add('connected'); }
      if (text) { text.textContent = '已连接'; }
    });

    WS.on('_disconnected', () => {
      const dot = document.getElementById('ws-dot');
      const text = document.getElementById('ws-text');
      if (dot) { dot.classList.remove('connected'); }
      if (text) { text.textContent = '未连接'; }
    });

    WS.on('client.count', (payload) => {
      const el = document.getElementById('client-count');
      if (el) el.textContent = payload.count;
    });

    // Update page title on route change
    Router.beforeEach((path) => {
      const key = path.replace('/', '');
      const title = pageTitles[key] || '多智能体平台';
      const titleEl = document.getElementById('page-title');
      if (titleEl) titleEl.textContent = title;
    });
  }

  return { init, render, loadCurrentWorkspace };
})();
