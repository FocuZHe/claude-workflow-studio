// ═══════════════════════════════════════════════
// Command Palette — Global search overlay
// ═══════════════════════════════════════════════

window.CommandPalette = (() => {
  let overlay = null;
  let input = null;
  let resultsEl = null;
  let selectedIndex = 0;
  let filteredItems = [];
  let isOpen = false;
  const STORAGE_KEY = 'cmd-palette-recent';
  const MAX_RESULTS = 20;

  function getRecentCommands() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveRecentCommand(label) {
    let recent = getRecentCommands();
    recent = recent.filter(r => r !== label);
    recent.unshift(label);
    if (recent.length > 10) recent = recent.slice(0, 10);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  }

  async function buildItems() {
    const items = [];

    // Pages
    const pages = [
      { icon: Icon.svg('dashboard', 16), label: '控制面板', action: () => Router.navigate('/dashboard') },
      { icon: Icon.svg('agents', 16), label: '智能体', action: () => Router.navigate('/agents') },
      { icon: Icon.svg('workflow', 16), label: '工作流', action: () => Router.navigate('/workflows') },
      { icon: Icon.svg('tasks', 16), label: '任务', action: () => Router.navigate('/tasks') },
      { icon: Icon.svg('files', 16), label: '文件', action: () => Router.navigate('/files') },
      { icon: Icon.svg('broadcast', 16), label: '广播', action: () => Router.navigate('/broadcast') },
      { icon: Icon.svg('history', 16), label: '历史', action: () => Router.navigate('/history') },
      { icon: Icon.svg('market', 16), label: '市场', action: () => Router.navigate('/market') },
      { icon: Icon.svg('settings', 16), label: '设置', action: () => Router.navigate('/settings') },
      { icon: Icon.svg('terminal', 16), label: '终端', action: () => Router.navigate('/terminal') },
      { icon: Icon.svg('chat', 16), label: '对话', action: () => Router.navigate('/chat') },
    ];
    pages.forEach(p => items.push({ ...p, category: '页面' }));

    // Actions
    const actions = [
      { icon: Icon.svg('plus', 16), label: '创建工作流', action: () => Router.navigate('/workflows') },
      { icon: Icon.svg('plus', 16), label: '创建任务', action: () => Router.navigate('/tasks') },
      { icon: Icon.svg('plus', 16), label: '创建智能体', action: () => Router.navigate('/agents') },
      { icon: Icon.svg('broadcast', 16), label: '发送广播', action: () => Router.navigate('/broadcast') },
    ];
    actions.forEach(a => items.push({ ...a, category: '操作' }));

    // Dynamic: Chat sessions
    try {
      const chatRes = await API.getChatSessions({ limit: 20 });
      const chatSessions = chatRes?.data?.items || [];
      chatSessions.forEach(s => {
        const preview = s.messages?.length > 0
          ? s.messages[s.messages.length - 1].content?.substring(0, 50) || ''
          : '';
        items.push({
          icon: Icon.svg('chat', 16),
          label: s.title || '新对话',
          description: preview,
          category: '对话',
          action: () => {
            Router.navigate('/chat');
            setTimeout(() => {
              if (typeof ChatPage !== 'undefined' && ChatPage.switchSession) {
                ChatPage.switchSession(s.id);
              }
            }, 100);
          },
        });
      });
    } catch (e) { /* ignore */ }

    // Dynamic: Agents from API
    try {
      const agentRes = await API.getAgents({ limit: 20 });
      const agents = agentRes?.data?.items || [];
      agents.forEach(a => {
        items.push({
          icon: Icon.svg('agents', 16),
          label: a.name || a.id,
          description: a.description || '',
          category: '智能体',
          action: () => Router.navigate('/agents'),
        });
      });
    } catch (e) { /* ignore */ }

    // Dynamic: Workflows from API (not Store, which may be empty)
    try {
      const wfRes = await API.getWorkflows({ limit: 50 });
      const workflows = wfRes?.data?.items || [];
      workflows.forEach(wf => {
        items.push({
          icon: Icon.svg('workflow', 16),
          label: wf.name || wf.id,
          category: '工作流',
          action: () => Router.navigate('/workflows'),
        });
      });
    } catch (e) { /* ignore */ }

    // Dynamic: Tasks from API
    try {
      const taskRes = await API.getTasks({ limit: 50 });
      const tasks = taskRes?.data?.items || [];
      tasks.forEach(t => {
        items.push({
          icon: Icon.svg('tasks', 16),
          label: t.title || t.name || t.id,
          category: '任务',
          action: () => Router.navigate('/tasks'),
        });
      });
    } catch (e) { /* ignore */ }

    return items;
  }

  function fuzzyMatch(query, text) {
    query = query.toLowerCase();
    text = text.toLowerCase();
    if (text.includes(query)) return true;
    let qi = 0;
    for (let ti = 0; ti < text.length && qi < query.length; ti++) {
      if (text[ti] === query[qi]) qi++;
    }
    return qi === query.length;
  }

  async function filterItems(query) {
    let items = [];
    try {
      items = await buildItems();
    } catch (e) {
      console.warn('[CommandPalette] buildItems failed:', e);
    }
    if (!items || items.length === 0) return [];
    const recent = getRecentCommands();

    if (!query) {
      // Show recent first, then all items
      const recentItems = items.filter(it => recent.includes(it.label));
      const otherItems = items.filter(it => !recent.includes(it.label));
      return [...recentItems, ...otherItems].slice(0, MAX_RESULTS);
    }

    const matched = items.filter(it => fuzzyMatch(query, it.label) || fuzzyMatch(query, it.category) || (it.description && fuzzyMatch(query, it.description)));
    // Prioritize recent
    matched.sort((a, b) => {
      const aR = recent.indexOf(a.label);
      const bR = recent.indexOf(b.label);
      if (aR >= 0 && bR < 0) return -1;
      if (aR < 0 && bR >= 0) return 1;
      return 0;
    });
    return matched.slice(0, MAX_RESULTS);
  }

  async function renderResults(query) {
    filteredItems = await filterItems(query);
    selectedIndex = 0;

    if (filteredItems.length === 0) {
      resultsEl.innerHTML = '<div class="cmd-palette-empty">没有匹配的结果</div>';
      return;
    }

    resultsEl.innerHTML = filteredItems.map((item, i) => `
      <div class="cmd-palette-item ${i === 0 ? 'selected' : ''}" data-index="${i}">
        <span class="cmd-palette-item-icon">${item.icon}</span>
        <span class="cmd-palette-item-label">${escapeHtml(item.label)}</span>
        <span class="cmd-palette-item-category">${escapeHtml(item.category)}</span>
      </div>
    `).join('');

    resultsEl.querySelectorAll('.cmd-palette-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index);
        executeItem(filteredItems[idx]);
      });
      el.addEventListener('mouseenter', () => {
        setSelected(parseInt(el.dataset.index));
      });
    });
  }

  function setSelected(index) {
    selectedIndex = index;
    resultsEl.querySelectorAll('.cmd-palette-item').forEach((el, i) => {
      el.classList.toggle('selected', i === index);
    });
    // Scroll into view
    const selected = resultsEl.querySelector('.cmd-palette-item.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  function executeItem(item) {
    if (!item) return;
    saveRecentCommand(item.label);
    close();
    item.action();
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function ensureOverlay() {
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.className = 'cmd-palette-overlay';
    overlay.id = 'cmd-palette-overlay';
    overlay.innerHTML = `
      <div class="cmd-palette">
        <div class="cmd-palette-input-wrap">
          <span class="search-icon">${Icon.svg('search', 16)}</span>
          <input class="cmd-palette-input" id="cmd-palette-input" type="text" placeholder="搜索页面、操作、工作流..." autocomplete="off" spellcheck="false">
        </div>
        <div class="cmd-palette-results" id="cmd-palette-results"></div>
        <div class="cmd-palette-footer">
          <span><kbd>↑↓</kbd> 导航 <kbd>Enter</kbd> 执行 <kbd>Esc</kbd> 关闭</span>
          <span>最近命令优先显示</span>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    input = overlay.querySelector('#cmd-palette-input');
    resultsEl = overlay.querySelector('#cmd-palette-results');

    // Click backdrop to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    // Input event
    input.addEventListener('input', async () => {
      await renderResults(input.value);
    });

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (selectedIndex < filteredItems.length - 1) setSelected(selectedIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectedIndex > 0) setSelected(selectedIndex - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executeItem(filteredItems[selectedIndex]);
      } else if (e.key === 'Escape') {
        close();
      }
    });

    return overlay;
  }

  async function open() {
    const el = ensureOverlay();
    el.offsetHeight; // force reflow
    el.classList.add('active');
    isOpen = true;
    input.value = '';
    await renderResults('');
    setTimeout(() => input.focus(), 50);
  }

  function close() {
    if (overlay) {
      overlay.classList.remove('active');
      isOpen = false;
    }
  }

  function toggle() {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }

  function init() {
    // Register Ctrl+K and Ctrl+P
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'p')) {
        e.preventDefault();
        toggle();
      }
    });
  }

  return { init, open, close, toggle };
})();
