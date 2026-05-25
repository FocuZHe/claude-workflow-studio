// ═══════════════════════════════════════════════
// Sidebar Component
// ═══════════════════════════════════════════════

window.Sidebar = (() => {
  const navGroups = [
    {
      label: '核心',
      items: [
        { path: '/dashboard', icon: 'dashboard', label: '控制面板' },
        { path: '/agents', icon: 'agents', label: '智能体' },
        { path: '/workflows', icon: 'workflow', label: '工作流' },
        { path: '/files', icon: 'files', label: '文件' },
        { path: '/tasks', icon: 'tasks', label: '任务' },
      ],
    },
    {
      label: '工具',
      items: [
        { path: '/terminal', icon: 'terminal', label: '终端' },
        { path: '/chat', icon: 'chat', label: '对话' },
      ],
    },
    {
      label: '数据',
      items: [
        { path: '/artifacts', icon: 'artifacts', label: '成果库' },
        { path: '/knowledge', icon: 'knowledge', label: '知识库' },
        { path: '/memory', icon: 'memory', label: '记忆' },
        { path: '/analytics', icon: 'analytics', label: '数据分析' },
        { path: '/history', icon: 'history', label: '历史' },
        { path: '/reports', icon: 'reports', label: '报告' },
      ],
    },
    {
      label: '系统',
      items: [
        { path: '/market', icon: 'market', label: '市场' },
        { path: '/broadcast', icon: 'broadcast', label: '广播' },
        { path: '/settings', icon: 'settings', label: '设置' },
      ],
    },
  ];

  const STORAGE_KEY = 'sidebar-collapsed';

  function isCollapsed() {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  }

  function setCollapsed(val) {
    localStorage.setItem(STORAGE_KEY, val ? 'true' : 'false');
  }

  function render() {
    const collapsed = isCollapsed();
    return `
      <button class="sidebar-toggle" id="sidebar-toggle" title="${collapsed ? '展开导航' : '收起导航'}">
        <span class="sidebar-toggle-icon">${Icon.svg(collapsed ? 'chevron-right' : 'chevron-left', 14)}</span>
      </button>
      ${navGroups.map(group => `
        <div class="sidebar-section">
          <div class="sidebar-label">${group.label}</div>
          ${group.items.map(item => `
            <div class="nav-item" data-route="${item.path}" title="${item.label}">
              <span class="nav-icon">${Icon.svg(item.icon, 18)}</span>
              <span>${item.label}</span>
            </div>
          `).join('')}
        </div>
      `).join('')}
    `;
  }

  function setActive(path) {
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.route === path);
    });
  }

  function applyCollapsed(collapsed) {
    const sidebar = document.getElementById('sidebar');
    const app = document.getElementById('app');
    const toggleIcon = document.querySelector('.sidebar-toggle-icon');
    const toggleBtn = document.getElementById('sidebar-toggle');

    if (sidebar) sidebar.classList.toggle('collapsed', collapsed);
    if (app) app.classList.toggle('sidebar-collapsed', collapsed);
    if (toggleIcon) toggleIcon.innerHTML = Icon.svg(collapsed ? 'chevron-right' : 'chevron-left', 14);
    if (toggleBtn) toggleBtn.title = collapsed ? '展开导航' : '收起导航';
  }

  function init() {
    const el = document.getElementById('sidebar');
    el.innerHTML = render();

    // Apply initial collapsed state
    applyCollapsed(isCollapsed());

    // Auto-collapse sidebar when viewport narrows
    let _sidebarTimer;
    window.addEventListener('resize', () => {
      clearTimeout(_sidebarTimer);
      _sidebarTimer = setTimeout(() => {
        if (window.innerWidth < 880 && !isCollapsed()) {
          setCollapsed(true);
          applyCollapsed(true);
        } else if (window.innerWidth > 1000 && isCollapsed()) {
          setCollapsed(false);
          applyCollapsed(false);
        }
      }, 200);
    });

    // Toggle click
    el.addEventListener('click', (e) => {
      const toggle = e.target.closest('#sidebar-toggle');
      if (toggle) {
        const newState = !isCollapsed();
        setCollapsed(newState);
        applyCollapsed(newState);
        return;
      }
      const item = e.target.closest('.nav-item');
      if (item) {
        Router.navigate(item.dataset.route);
      }
    });

    Router.beforeEach((path) => setActive(path));
  }

  return { init, render };
})();
