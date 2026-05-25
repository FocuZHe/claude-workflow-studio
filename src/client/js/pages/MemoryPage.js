// ═══════════════════════════════════════════════
// Memory Page — Workflow Memory Management
// ═══════════════════════════════════════════════

window.MemoryPage = (() => {
  let _memories = [];
  let _workspaceFilter = null;  // null = 全部
  let _workspaceList = [];

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function render() {
    const el = document.getElementById('content');
    el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">${Icon.svg('memory', 20)}</span> 工作流记忆</h1>
          <select class="input select-md" id="memory-workspace-filter">
            <option value="">全部工作区</option>
          </select>
          <div style="display:flex;gap:4px;">
            <input class="input search-input-sm" id="memory-search" placeholder="搜索记忆内容...">
            <button class="btn btn-secondary" id="memory-search-btn">搜索</button>
          </div>
          <button class="btn btn-secondary" id="memory-refresh-btn">刷新</button>
        </div>
        <div id="memory-shared-pool" style="margin-bottom:16px;"></div>
        <div id="memory-list"></div>
      </div>
    `;

    document.getElementById('memory-refresh-btn').addEventListener('click', () => {
      loadMemories();
      loadSharedPool();
    });
    document.getElementById('memory-search-btn').addEventListener('click', searchMemories);
    document.getElementById('memory-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchMemories();
    });
    document.getElementById('memory-workspace-filter').addEventListener('change', (e) => {
      _workspaceFilter = e.target.value || null;
      renderMemoryList(_memories);
    });
    await loadMemories();
    await loadSharedPool();
  }

  async function loadMemories() {
    const listEl = document.getElementById('memory-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="empty-state" style="padding:20px;"><div class="empty-desc">加载中...</div></div>';

    try {
      const res = await API.listMemories();
      _memories = res.data?.items || res.data || [];

      // 提取工作区列表用于下拉筛选
      const wsSet = new Map();
      for (const m of _memories) {
        if (m.workspaceId && !wsSet.has(m.workspaceId)) {
          wsSet.set(m.workspaceId, m.workspaceName || m.workspaceId.substring(0, 8));
        }
      }
      _workspaceList = Array.from(wsSet.entries()).map(([id, name]) => ({ id, name }));
      const wsFilter = document.getElementById('memory-workspace-filter');
      if (wsFilter) {
        wsFilter.innerHTML = '<option value="">全部工作区</option>' +
          _workspaceList.map(ws => `<option value="${ws.id}" ${_workspaceFilter === ws.id ? 'selected' : ''}>${escapeHtml(ws.name)}</option>`).join('');
      }

      renderMemoryList(_memories);
    } catch (e) {
      listEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--accent-red);">加载失败: ${escapeHtml(e.message)}</div>`;
    }
  }

  function getFilteredMemories() {
    if (!_workspaceFilter) return _memories;
    return _memories.filter(m => m.workspaceId === _workspaceFilter || !m.workspaceId);
  }

  function renderMemoryList(memories) {
    const listEl = document.getElementById('memory-list');
    if (!listEl) return;
    const filtered = _workspaceFilter ? getFilteredMemories() : memories;
    // 重新应用过滤
    const items = _workspaceFilter ? _memories.filter(m => !m.workspaceId || m.workspaceId === _workspaceFilter) : _memories;

    if (items.length === 0) {
      listEl.innerHTML = _workspaceFilter
        ? EmptyState.render({ icon: Icon.svg('memory', 40), title: '该工作区暂无记忆数据', description: '工作流执行后会自动生成记忆' })
        : EmptyState.render({ icon: Icon.svg('memory', 40), title: '暂无记忆数据', description: '工作流执行后会自动生成记忆' });
      return;
    }

    listEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;">
        ${items.map(m => `
          <div class="card card-memory" style="padding:12px;cursor:pointer;" data-workflow="${m.workflowId}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <div style="font-weight:600;font-size:13px;">${escapeHtml(m.workflowName || '工作流')}</div>
              ${m.workspaceId ? `<span class="badge badge-idle">${escapeHtml(m.workspaceName || m.workspaceId.substring(0,8))}</span>` : '<span class="badge badge-draft">全局</span>'}
            </div>
            <div style="font-size:11px;color:var(--text-tertiary);">点击查看记忆内容</div>
          </div>
        `).join('')}
      </div>
    `;

    listEl.querySelectorAll('.card[data-workflow]').forEach(card => {
      card.addEventListener('click', () => viewMemory(card.dataset.workflow));
    });
  }

  async function loadSharedPool() {
    const poolEl = document.getElementById('memory-shared-pool');
    if (!poolEl) return;
    try {
      const res = await API.getSharedPool();
      const pool = res.data || {};
      poolEl.innerHTML = `
        <div class="card card-memory" style="padding:12px;">
          <div style="font-weight:600;font-size:13px;margin-bottom:8px;">共享数据池</div>
          <div class="code-block" style="max-height:150px;overflow:auto;">${escapeHtml(JSON.stringify(pool, null, 2))}</div>
        </div>
      `;
    } catch (e) {
      poolEl.innerHTML = '';
    }
  }

  async function viewMemory(workflowId) {
    try {
      const res = await API.getMemory(workflowId);
      const content = res.data?.content || '(空)';
      Modal.open({
        title: `工作流记忆`,
        body: `<div class="code-block" style="max-height:400px;overflow:auto;">${escapeHtml(content)}</div>`,
        footer: `
          <button class="btn btn-secondary" onclick="Modal.close()">关闭</button>
          <button class="btn btn-danger" id="delete-memory-btn">删除</button>
        `
      });
      document.getElementById('delete-memory-btn')?.addEventListener('click', async () => {
        if (!confirm('确定删除此工作流的记忆？')) return;
        try {
          await API.deleteMemory(workflowId);
          Toast.success('已删除');
          Modal.close();
          await loadMemories();
        } catch (e) {
          Toast.error('删除失败: ' + e.message);
        }
      });
    } catch (e) {
      Toast.error('获取记忆失败: ' + e.message);
    }
  }

  async function searchMemories() {
    const query = document.getElementById('memory-search')?.value.trim();
    if (!query) {
      await loadMemories();
      return;
    }

    const listEl = document.getElementById('memory-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="empty-state" style="padding:20px;"><div class="empty-desc">搜索中...</div></div>';

    try {
      const res = await API.searchMemories(query);
      const results = res.data || [];

      if (results.length === 0) {
        listEl.innerHTML = EmptyState.render({ icon: Icon.svg('memory', 40), title: '未找到匹配的记忆', description: '请尝试其他搜索关键词' });
        return;
      }

      listEl.innerHTML = `
        <div style="margin-bottom:12px;font-size:12px;color:var(--text-secondary);">找到 ${results.length} 条结果</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;">
          ${results.map(m => `
            <div class="card card-memory" style="padding:12px;cursor:pointer;" data-workflow="${m.workflowId}">
              <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${escapeHtml(m.workflowName || '工作流')}</div>
              <div style="font-size:11px;color:var(--text-tertiary);max-height:60px;overflow:hidden;">${escapeHtml(m.preview || '')}</div>
            </div>
          `).join('')}
        </div>
      `;

      listEl.querySelectorAll('.card[data-workflow]').forEach(card => {
        card.addEventListener('click', () => viewMemory(card.dataset.workflow));
      });
    } catch (e) {
      listEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--accent-red);">搜索失败: ${escapeHtml(e.message)}</div>`;
    }
  }

  function cleanup() {
    _memories = [];
  }

  return { render, cleanup };
})();
