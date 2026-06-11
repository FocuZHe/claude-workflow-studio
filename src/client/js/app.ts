// ═══════════════════════════════════════════════
// App Initialization
// ═══════════════════════════════════════════════

(function () {
  'use strict';

  // Register routes
  (Router as any).register('/dashboard', () => (DashboardPage as any).render());
  (Router as any).register('/agents', () => (AgentsPage as any).render());
  (Router as any).register('/workflows', () => (WorkflowsPage as any).render());
  (Router as any).register('/tasks', () => (TasksPage as any).render());
  (Router as any).register('/task-queues', () => (TaskQueuePage as any).render());
  (Router as any).register('/files', () => (FilesPage as any).render());
  (Router as any).register('/workspaces', () => (Router as any).navigate('/files'));
  (Router as any).register('/broadcast', () => (BroadcastPage as any).render());
  (Router as any).register('/history', () => (HistoryPage as any).render());
  (Router as any).register('/reports', () => (ReportsPage as any).render());
  (Router as any).register('/market', () => renderMarketPage());
  (Router as any).register('/settings', () => (SettingsPage as any).render());
  (Router as any).register('/terminal', () => (TerminalPage as any).render());
  (Router as any).register('/chat', () => (ChatPage as any).render());
  (Router as any).register('/artifacts', () => (ArtifactsPage as any).render());
  (Router as any).register('/memory', () => (MemoryPage as any).render());
  (Router as any).register('/knowledge', () => (KnowledgePage as any).render());
  (Router as any).register('/analytics', () => (AnalyticsPage as any).render());
  (Router as any).register('/safety', () => (SafetyPage as any).render());

  // Market page with tabs
  function renderMarketPage(): void {
    const el = document.getElementById('content')!;
    el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">${(Icon as any).svg('market', 20)}</span> 市场</h1>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <button class="btn btn-primary market-tab-btn" data-tab="skills">Skills 技能</button>
          <button class="btn btn-secondary market-tab-btn" data-tab="templates">工作流模板</button>
        </div>
        <div id="market-content"></div>
      </div>
    `;

    let currentTab = 'skills';

    function switchTab(tab: string): void {
      currentTab = tab;
      el.querySelectorAll('.market-tab-btn').forEach(btn => {
        (btn as HTMLElement).className = 'btn ' + ((btn as HTMLElement).dataset.tab === tab ? 'btn-primary' : 'btn-secondary') + ' market-tab-btn';
      });
      const mc = document.getElementById('market-content');
      if (!mc) return;
      if (tab === 'skills') {
        (SkillsMarket as any).render('market-content');
      } else if (tab === 'templates') {
        (WorkflowTemplates as any).render('market-content');
      }
    }

    el.querySelectorAll('.market-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab((btn as HTMLElement).dataset.tab!));
    });

    switchTab('skills');
  }

  // Cleanup on route change
  let previousPage: string | null = null;
  (Router as any).beforeEach((newPath: string, oldPath: string) => {
    const cleanupMap: Record<string, () => void> = {
      '/dashboard': () => (DashboardPage as any).cleanup?.(),
      '/agents': () => (AgentsPage as any).cleanup?.(),
      '/workflows': () => (WorkflowsPage as any).cleanup?.(),
      '/tasks': () => (TasksPage as any).cleanup?.(),
      '/task-queues': () => (TaskQueuePage as any).cleanup?.(),
      '/broadcast': () => (BroadcastPage as any).cleanup?.(),
      '/files': () => (FilesPage as any).cleanup?.(),
      '/history': () => (HistoryPage as any).cleanup?.(),
      '/reports': () => (ReportsPage as any).cleanup?.(),
      '/chat': () => (ChatPage as any).cleanup?.(),
      '/terminal': () => (TerminalPage as any).cleanup?.(),
      '/artifacts': () => (ArtifactsPage as any).cleanup?.(),
      '/memory': () => (MemoryPage as any).cleanup?.(),
      '/knowledge': () => (KnowledgePage as any).cleanup?.(),
      '/analytics': () => (AnalyticsPage as any).cleanup?.(),
      '/safety': () => (SafetyPage as any).cleanup?.(),
    };
    if (previousPage && cleanupMap[previousPage]) {
      cleanupMap[previousPage]();
    }
    previousPage = newPath;
  });

  // ── Sidebar: overlay mode when window < 30% of screen width (max 700px) ──
  function updateSidebarMode(): void {
    const threshold = Math.min(window.screen.width * 0.3, 700);
    const app = document.getElementById('app');
    if (app) {
      app.classList.toggle('sidebar-overlay', window.innerWidth < threshold);
    }
  }

  // ── Font scaling on resize ──
  function updateFontScale(): void {
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
  let _fontTimer: ReturnType<typeof setTimeout>;
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
    (Navbar as any).init();
    (Sidebar as any).init();
    (WS as any).init();
    (Router as any).init();
    (NotificationManager as any).init();
    (CommandPalette as any).init();

    // Fetch workspace state on startup
    try {
      const res = await (API as any).getWorkspaceState();
      if (res?.data && typeof Store !== 'undefined' && (Store as any).setState) {
        (Store as any).setState(res.data);
      }
    } catch (e: any) {
      console.warn('[App] 获取工作区状态失败:', e.message);
    }

    // Check API key configuration
    if (typeof (window as any).ApiKeyPrompt !== 'undefined') {
      (window as any).ApiKeyPrompt.init();
    }
  });
})();
