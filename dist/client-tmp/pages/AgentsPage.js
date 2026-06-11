"use strict";
window.AgentsPage = (() => {
    let agents = [];
    let filterStatus = '';
    let filterRole = '';
    let searchQuery = '';
    let _wsUnsubs = [];
    let _selectionMode = false;
    let _selectedIds = new Set();
    const PAGE_SIZE = 20;
    let _currentPage = 1;
    let _totalItems = 0;
    let _loadingMore = false;
    let _pageVer = 1;
    let _expandedAgentIds = new Set(); // Track which agents are expanded
    let _childAgentsCache = {}; // Cache: parentId -> child agents array
    async function render() {
        _pageVer++;
        const el = document.getElementById('content');
        el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">${Icon.svg('agents', 20)}</span> 智能体</h1>
          <div class="page-actions">
            <button class="btn btn-secondary" id="batch-select-btn">批量选择</button>
            <button class="btn btn-primary" id="create-agent-btn">+ 创建智能体</button>
          </div>
        </div>
        <div class="toolbar">
          <div class="search-input">
            <span class="search-icon">${Icon.svg('search', 16)}</span>
            <input class="input" id="agent-search" placeholder="搜索智能体..." style="width:220px;">
          </div>
          <div class="toolbar-separator"></div>
          <select class="select select-md" id="filter-status">
            <option value="">全部状态</option>
            <option value="idle">空闲</option>
            <option value="busy">忙碌</option>
            <option value="error">错误</option>
            <option value="offline">离线</option>
          </select>
          <select class="select select-md" id="filter-role">
            <option value="">全部角色</option>
            <option value="developer">开发者</option>
            <option value="reviewer">审查员</option>
            <option value="tester">测试员</option>
            <option value="planner">规划师</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        <div class="grid-3 stagger" id="agents-grid">
          <div class="empty-state" style="grid-column:1/-1;">
            <div class="empty-icon">${Icon.svg('agents', 24)}</div>
            <div class="empty-title">加载智能体中...</div>
          </div>
        </div>
      </div>
    `;
        document.getElementById('create-agent-btn').addEventListener('click', openCreateModal);
        document.getElementById('batch-select-btn').addEventListener('click', toggleSelectionMode);
        let _searchTimer;
        document.getElementById('agent-search').addEventListener('input', (e) => {
            const target = e.target;
            if (e.isComposing)
                return;
            clearTimeout(_searchTimer);
            _searchTimer = setTimeout(() => {
                searchQuery = target.value.toLowerCase();
                agents = [];
                _currentPage = 1;
                _totalItems = 0;
                loadAgents(1);
            }, 300);
        });
        document.getElementById('agent-search').addEventListener('compositionend', (e) => {
            const target = e.target;
            clearTimeout(_searchTimer);
            _searchTimer = setTimeout(() => {
                searchQuery = (target.value || e.data || '').toLowerCase();
                agents = [];
                _currentPage = 1;
                _totalItems = 0;
                loadAgents(1);
            }, 300);
        });
        document.getElementById('filter-status').addEventListener('change', (e) => {
            filterStatus = e.target.value;
            agents = [];
            _currentPage = 1;
            _totalItems = 0;
            loadAgents(1);
        });
        document.getElementById('filter-role').addEventListener('change', (e) => {
            filterRole = e.target.value;
            agents = [];
            _currentPage = 1;
            _totalItems = 0;
            loadAgents(1);
        });
        // Clean up previous listeners
        _wsUnsubs.forEach((fn) => fn());
        _wsUnsubs = [];
        // Real-time updates
        _wsUnsubs.push(WS.on('agent.statusUpdate', onAgentUpdate));
        _wsUnsubs.push(WS.on('agent.created', onAgentCreatedOrDeleted));
        _wsUnsubs.push(WS.on('agent.updated', () => loadAgents()));
        _wsUnsubs.push(WS.on('agent.deleted', onAgentCreatedOrDeleted));
        // Listen for WebSocket reconnection to refresh data (remove first to prevent duplicates)
        window.removeEventListener('ws:reconnected', _onReconnect);
        window.addEventListener('ws:reconnected', _onReconnect);
        await loadAgents();
    }
    async function loadAgents(page) {
        if (_pageVer < 0)
            return;
        if (page === undefined)
            page = 1;
        if (_loadingMore)
            return;
        _loadingMore = true;
        const ver = _pageVer;
        try {
            const params = { page, limit: PAGE_SIZE };
            if (filterStatus)
                params.status = filterStatus;
            if (filterRole)
                params.role = filterRole;
            const res = await API.getAgents(params);
            if (ver !== _pageVer)
                return;
            const d = res.data;
            const items = Array.isArray(d) ? d : (d?.items || []);
            const meta = res.meta || {};
            if (ver !== _pageVer)
                return;
            if (page === 1) {
                agents = items;
                // Preserve expanded state but clear child cache for refresh
                _childAgentsCache = {};
            }
            else {
                agents = [...agents, ...items];
            }
            _currentPage = meta.page || page;
            _totalItems = meta.total || agents.length;
            renderGrid();
        }
        catch (e) {
            if (ver !== _pageVer)
                return;
            Toast.error('加载智能体失败');
        }
        finally {
            if (ver === _pageVer)
                _loadingMore = false;
        }
    }
    function getFiltered() {
        // Status/role filters are now applied server-side; only search is client-side
        if (!searchQuery)
            return agents;
        return agents.filter((a) => a.name.toLowerCase().includes(searchQuery) ||
            (a.description || '').toLowerCase().includes(searchQuery));
    }
    function renderGrid() {
        const grid = document.getElementById('agents-grid');
        if (!grid)
            return;
        const filtered = getFiltered();
        if (filtered.length === 0 && _currentPage <= 1) {
            grid.innerHTML = `<div style="grid-column:1/-1;">${EmptyState.render({
                icon: Icon.svg('agents', 24),
                title: '还没有智能体',
                description: '创建你的第一个智能体来开始使用多 Agent 协作',
                actionText: '+ 创建智能体',
                actionId: 'empty-create-agent-btn'
            })}</div>`;
            document.getElementById('empty-create-agent-btn')?.addEventListener('click', openCreateModal);
            const paginationEl = document.getElementById('agents-pagination');
            if (paginationEl)
                paginationEl.innerHTML = '';
            return;
        }
        grid.innerHTML = filtered.map((a) => {
            const isExpanded = _expandedAgentIds.has(a.id);
            a._hasChildren = _childAgentsCache[a.id]?.length > 0 || a._childCount > 0;
            if (_selectionMode) {
                const isChecked = _selectedIds.has(a.id);
                return `<div style="position:relative;"><div style="position:absolute;top:12px;left:12px;z-index:10;"><input type="checkbox" class="batch-checkbox" data-id="${a.id}" ${isChecked ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent-cyan);"></div>${AgentCard.render(a, { isExpanded })}</div>`;
            }
            return AgentCard.render(a, { isExpanded });
        }).join('') + renderLoadMoreButton(agents.length, _totalItems, 'load-more-agents');
        // Bind card actions
        grid.querySelectorAll('.agent-card').forEach((card) => {
            const id = card.dataset.id;
            card.querySelector('.btn-edit')?.addEventListener('click', (e) => { e.stopPropagation(); openEditModal(id); });
            card.querySelector('.btn-delete')?.addEventListener('click', (e) => { e.stopPropagation(); deleteAgent(id); });
            if (!_selectionMode)
                card.addEventListener('click', (e) => {
                    // Don't open detail if clicking on expand toggle
                    if (e.target.closest('.agent-card-expand-toggle'))
                        return;
                    openDetailModal(id);
                });
        });
        // Bind expand toggles
        grid.querySelectorAll('.agent-card-expand-toggle').forEach((toggle) => {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const agentId = toggle.dataset.agentId;
                toggleExpand(agentId);
            });
        });
        // Render children for expanded agents
        filtered.forEach((a) => {
            if (_expandedAgentIds.has(a.id)) {
                renderChildren(a.id);
            }
        });
        // Batch checkbox events
        grid.querySelectorAll('.batch-checkbox').forEach((cb) => {
            cb.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSelectItem(cb.dataset.id);
            });
        });
        // Bind load more
        bindLoadMoreButton('load-more-agents', () => loadAgents(_currentPage + 1));
        // Update pagination info
        renderPaginationInfo();
    }
    async function toggleExpand(agentId) {
        if (_expandedAgentIds.has(agentId)) {
            _expandedAgentIds.delete(agentId);
            renderGrid();
        }
        else {
            _expandedAgentIds.add(agentId);
            renderGrid();
            await loadChildren(agentId);
        }
    }
    async function loadChildren(parentId) {
        const container = document.querySelector(`.agent-children-container[data-parent-id="${parentId}"]`);
        if (!container)
            return;
        // Use cached data if available
        if (_childAgentsCache[parentId]) {
            renderChildren(parentId);
            return;
        }
        container.innerHTML = `<div style="padding:8px 12px;font-size:12px;color:var(--text-muted);">加载子智能体...</div>`;
        container.style.display = 'block';
        try {
            const res = await API.getAgentChildren(parentId);
            const children = res.data || [];
            _childAgentsCache[parentId] = children;
            renderChildren(parentId);
        }
        catch (e) {
            container.innerHTML = `<div style="padding:8px 12px;font-size:12px;color:var(--accent-red);">加载失败</div>`;
        }
    }
    function renderChildren(parentId) {
        const container = document.querySelector(`.agent-children-container[data-parent-id="${parentId}"]`);
        if (!container)
            return;
        const children = _childAgentsCache[parentId] || [];
        if (children.length === 0) {
            container.innerHTML = `<div style="padding:8px 12px;font-size:12px;color:var(--text-muted);">暂无子智能体</div>`;
            container.style.display = 'block';
            return;
        }
        container.innerHTML = children.map((child) => AgentCard.renderChildCard(child)).join('');
        container.style.display = 'block';
        // Bind child card actions
        container.querySelectorAll('.child-agent-card').forEach((card) => {
            const id = card.dataset.id;
            card.querySelector('.btn-edit')?.addEventListener('click', (e) => { e.stopPropagation(); openEditModal(id); });
            card.querySelector('.btn-delete')?.addEventListener('click', (e) => { e.stopPropagation(); deleteAgent(id); });
            card.addEventListener('click', () => openDetailModal(id));
        });
    }
    function renderPaginationInfo() {
        let paginationEl = document.getElementById('agents-pagination');
        if (!paginationEl) {
            const grid = document.getElementById('agents-grid');
            if (!grid)
                return;
            paginationEl = document.createElement('div');
            paginationEl.id = 'agents-pagination';
            paginationEl.className = 'pagination-info';
            grid.parentNode.insertBefore(paginationEl, grid.nextSibling);
        }
        paginationEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">已加载 ${agents.length} / ${_totalItems} 条</span>`;
    }
    const _throttledRenderGrid = throttle(() => renderGrid(), 500);
    function onAgentUpdate(payload) {
        const idx = agents.findIndex((a) => a.id === payload.agentId);
        if (idx >= 0) {
            agents[idx].status = payload.status;
            _throttledRenderGrid();
        }
    }
    function onAgentCreatedOrDeleted() {
        _childAgentsCache = {};
        loadAgents();
    }
    function openCreateModal() {
        AgentCreate.open(async (data) => {
            const btn = document.querySelector('.modal .btn-primary');
            if (btn) {
                btn.disabled = true;
                btn.textContent = '创建中...';
            }
            try {
                await API.createAgent(data);
                Toast.success('智能体已创建');
                Modal.close();
                await loadAgents();
            }
            catch (e) {
                Toast.error(e.message);
            }
            finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '+ 创建智能体';
                }
            }
        });
    }
    async function openEditModal(id) {
        try {
            const res = await API.getAgent(id);
            AgentDetail.open(res.data, async (data) => {
                try {
                    await API.updateAgent(id, data);
                    Toast.success('智能体已更新');
                    Modal.close();
                    await loadAgents();
                }
                catch (e) {
                    Toast.error(e.message);
                }
            });
        }
        catch (e) {
            Toast.error('加载智能体失败');
        }
    }
    async function openDetailModal(id) {
        try {
            const res = await API.getAgent(id);
            const logsRes = await API.getAgentLogs(id).catch(() => ({ data: [] }));
            AgentDetail.openDetail(res.data, logsRes.data || []);
        }
        catch (e) {
            Toast.error('加载智能体详情失败');
        }
    }
    async function deleteAgent(id) {
        if (!await Modal.confirm('删除智能体', '确定删除此智能体？'))
            return;
        const card = document.querySelector(`.agent-card[data-id="${id}"]`);
        const btn = card?.querySelector('.btn-delete');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '...';
        }
        try {
            await API.deleteAgent(id);
            Toast.success('智能体已删除');
            await loadAgents();
        }
        catch (e) {
            Toast.error(e.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = Icon.svg('close', 14);
            }
        }
    }
    // ── Batch Selection ──────────────────────────────────────────
    function toggleSelectionMode() {
        _selectionMode = !_selectionMode;
        if (!_selectionMode) {
            _selectedIds.clear();
            removeBatchActionBar();
        }
        else {
            showBatchActionBar();
        }
        renderGrid();
    }
    function toggleSelectItem(id) {
        if (_selectedIds.has(id)) {
            _selectedIds.delete(id);
        }
        else {
            _selectedIds.add(id);
        }
        updateBatchActionBar();
        updateCheckboxes();
    }
    function updateCheckboxes() {
        document.querySelectorAll('.batch-checkbox').forEach((cb) => {
            cb.checked = _selectedIds.has(cb.dataset.id);
        });
    }
    function showBatchActionBar() {
        removeBatchActionBar();
        const bar = document.createElement('div');
        bar.id = 'batch-action-bar';
        bar.className = 'batch-action-bar';
        bar.innerHTML = `
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;color:var(--text-secondary);">
        <input type="checkbox" id="batch-select-all" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent-cyan);"> 全选
      </label>
      <span style="font-size:13px;color:var(--text-secondary);">已选择 <strong id="batch-count" style="color:var(--accent-cyan);">${_selectedIds.size}</strong> 项</span>
      <button class="btn btn-sm btn-danger" id="batch-delete-btn">批量删除</button>
      <button class="btn btn-sm btn-secondary" id="batch-cancel-btn">取消选择</button>
    `;
        document.body.appendChild(bar);
        document.getElementById('batch-delete-btn').addEventListener('click', batchDelete);
        document.getElementById('batch-cancel-btn').addEventListener('click', () => { _selectionMode = false; _selectedIds.clear(); removeBatchActionBar(); renderGrid(); });
        document.getElementById('batch-select-all')?.addEventListener('change', (e) => {
            const allCbs = document.querySelectorAll('.batch-checkbox');
            allCbs.forEach((cb) => { cb.checked = e.target.checked; });
            if (e.target.checked) {
                agents.forEach((a) => _selectedIds.add(a.id));
            }
            else {
                _selectedIds.clear();
            }
            updateBatchActionBar();
        });
    }
    function removeBatchActionBar() {
        document.getElementById('batch-action-bar')?.remove();
    }
    function updateBatchActionBar() {
        const countEl = document.getElementById('batch-count');
        if (countEl)
            countEl.textContent = String(_selectedIds.size);
        if (_selectedIds.size > 0 && !document.getElementById('batch-action-bar')) {
            showBatchActionBar();
        }
        else if (_selectedIds.size === 0) {
            removeBatchActionBar();
        }
    }
    async function batchDelete() {
        if (_selectedIds.size === 0)
            return;
        if (!await Modal.confirm('批量删除', `确定删除选中的 ${_selectedIds.size} 个智能体？此操作不可撤销。`))
            return;
        const ids = Array.from(_selectedIds);
        try {
            await API.deleteAgentsBatch(ids);
            Toast.success(`已删除 ${ids.length} 个智能体`);
            _selectionMode = false;
            _selectedIds.clear();
            removeBatchActionBar();
            await loadAgents();
        }
        catch (e) {
            Toast.error('批量删除失败: ' + e.message);
        }
    }
    function _onReconnect() {
        console.log('[AgentsPage] WebSocket reconnected, refreshing data...');
        loadAgents();
    }
    function cleanup() {
        _pageVer = -1;
        _wsUnsubs.forEach((fn) => fn());
        _wsUnsubs = [];
        window.removeEventListener('ws:reconnected', _onReconnect);
        _selectionMode = false;
        _selectedIds.clear();
        _expandedAgentIds.clear();
        _childAgentsCache = {};
        removeBatchActionBar();
    }
    return { render, cleanup };
})();
