"use strict";
// ═══════════════════════════════════════════════
// App Initialization
// ═══════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
(function () {
    'use strict';
    // Register routes
    Router.register('/dashboard', () => DashboardPage.render());
    Router.register('/agents', () => AgentsPage.render());
    Router.register('/workflows', () => WorkflowsPage.render());
    Router.register('/tasks', () => TasksPage.render());
    Router.register('/task-queues', () => TaskQueuePage.render());
    Router.register('/files', () => FilesPage.render());
    Router.register('/workspaces', () => Router.navigate('/files'));
    Router.register('/broadcast', () => BroadcastPage.render());
    Router.register('/history', () => HistoryPage.render());
    Router.register('/reports', () => ReportsPage.render());
    Router.register('/market', () => renderMarketPage());
    Router.register('/settings', () => SettingsPage.render());
    Router.register('/terminal', () => TerminalPage.render());
    Router.register('/chat', () => ChatPage.render());
    Router.register('/artifacts', () => ArtifactsPage.render());
    Router.register('/memory', () => MemoryPage.render());
    Router.register('/knowledge', () => KnowledgePage.render());
    Router.register('/analytics', () => AnalyticsPage.render());
    Router.register('/safety', () => SafetyPage.render());
    // Market page with tabs
    function renderMarketPage() {
        const el = document.getElementById('content');
        el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">${Icon.svg('market', 20)}</span> 市场</h1>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <button class="btn btn-primary market-tab-btn" data-tab="skills">Skills 技能</button>
          <button class="btn btn-secondary market-tab-btn" data-tab="templates">工作流模板</button>
        </div>
        <div id="market-content"></div>
      </div>
    `;
        let currentTab = 'skills';
        function switchTab(tab) {
            currentTab = tab;
            el.querySelectorAll('.market-tab-btn').forEach(btn => {
                btn.className = 'btn ' + (btn.dataset.tab === tab ? 'btn-primary' : 'btn-secondary') + ' market-tab-btn';
            });
            const mc = document.getElementById('market-content');
            if (!mc)
                return;
            if (tab === 'skills') {
                SkillsMarket.render('market-content');
            }
            else if (tab === 'templates') {
                WorkflowTemplates.render('market-content');
            }
        }
        el.querySelectorAll('.market-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });
        switchTab('skills');
    }
    // Cleanup on route change
    let previousPage = null;
    Router.beforeEach((newPath, oldPath) => {
        const cleanupMap = {
            '/dashboard': () => DashboardPage.cleanup?.(),
            '/agents': () => AgentsPage.cleanup?.(),
            '/workflows': () => WorkflowsPage.cleanup?.(),
            '/tasks': () => TasksPage.cleanup?.(),
            '/task-queues': () => TaskQueuePage.cleanup?.(),
            '/broadcast': () => BroadcastPage.cleanup?.(),
            '/files': () => FilesPage.cleanup?.(),
            '/history': () => HistoryPage.cleanup?.(),
            '/reports': () => ReportsPage.cleanup?.(),
            '/chat': () => ChatPage.cleanup?.(),
            '/terminal': () => TerminalPage.cleanup?.(),
            '/artifacts': () => ArtifactsPage.cleanup?.(),
            '/memory': () => MemoryPage.cleanup?.(),
            '/knowledge': () => KnowledgePage.cleanup?.(),
            '/analytics': () => AnalyticsPage.cleanup?.(),
            '/safety': () => SafetyPage.cleanup?.(),
        };
        if (previousPage && cleanupMap[previousPage]) {
            cleanupMap[previousPage]();
        }
        previousPage = newPath;
    });
    // ── Sidebar: overlay mode when window < 30% of screen width (max 700px) ──
    function updateSidebarMode() {
        const threshold = Math.min(window.screen.width * 0.3, 700);
        const app = document.getElementById('app');
        if (app) {
            app.classList.toggle('sidebar-overlay', window.innerWidth < threshold);
        }
    }
    // ── Font scaling on resize ──
    function updateFontScale() {
        const diag = Math.sqrt(window.screen.width ** 2 + window.screen.height ** 2);
        const isLargeNative = diag > 2400 && window.devicePixelRatio <= 1.25;
        const baseFontRef = isLargeNative
            ? Math.min(15 * diag / 2203, 18)
            : 15;
        const vpDiag = Math.sqrt(window.innerWidth ** 2 + window.innerHeight ** 2);
        const refDiag = 2203;
        const minSize = baseFontRef * 0.7;
        const base = vpDiag >= refDiag
            ? baseFontRef
            : Math.min(baseFontRef, Math.max(minSize, baseFontRef * vpDiag / refDiag) * 1.1);
        document.documentElement.style.fontSize = base + 'px';
    }
    let _fontTimer;
    window.addEventListener('resize', () => {
        clearTimeout(_fontTimer);
        _fontTimer = setTimeout(() => {
            updateFontScale();
            updateSidebarMode();
        }, 60);
    });
    // Initialize
    document.addEventListener('DOMContentLoaded', async () => {
        updateFontScale();
        updateSidebarMode();
        Navbar.init();
        Sidebar.init();
        WS.init();
        Router.init();
        NotificationManager.init();
        CommandPalette.init();
        // Fetch workspace state on startup
        try {
            const res = await API.getWorkspaceState();
            if (res?.data && typeof Store !== 'undefined' && Store.setState) {
                Store.setState(res.data);
            }
        }
        catch (e) {
            console.warn('[App] 获取工作区状态失败:', e.message);
        }
        // Check API key configuration
        if (typeof window.ApiKeyPrompt !== 'undefined') {
            window.ApiKeyPrompt.init();
        }
    });
})();
//# sourceMappingURL=app.js.map