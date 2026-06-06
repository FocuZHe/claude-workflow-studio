"use strict";
window.WorkspacesPage = (() => {
    let workspaces = [];
    async function render() {
        const el = document.getElementById('content');
        if (!el)
            return;
        el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">&#x229e;</span> 工作区管理</h1>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-secondary" id="ws-refresh-btn">刷新</button>
            <button class="btn btn-primary" id="ws-activate-btn">+ 激活新工作区</button>
          </div>
        </div>
        <div id="ws-grid"></div>
        <div style="padding:12px 0;text-align:center;color:var(--text-tertiary);font-size:12px;">
          激活多个工作区后，各工作区的工作流可并行执行
        </div>
      </div>
    `;
        document.getElementById('ws-activate-btn').addEventListener('click', activateWorkspace);
        document.getElementById('ws-refresh-btn').addEventListener('click', loadWorkspaces);
        await loadWorkspaces();
    }
    async function loadWorkspaces() {
        try {
            const res = await API.getWorkspaces();
            workspaces = res.data || [];
            Store.set('activeWorkspaces', workspaces);
            renderWorkspaceGrid(workspaces);
        }
        catch (e) {
            Toast.error('加载工作区列表失败');
            renderWorkspaceGrid([]);
        }
    }
    function renderWorkspaceGrid(wsList) {
        const container = document.getElementById('ws-grid');
        if (!container)
            return;
        if (wsList.length === 0) {
            container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">&#x229e;</div>
          <div class="empty-title">暂无活跃工作区</div>
          <div class="empty-desc">点击"激活新工作区"按钮选择一个目录作为工作区</div>
        </div>
      `;
            return;
        }
        container.innerHTML = `
      <div class="grid-3 stagger">
        ${wsList.map((ws) => renderWorkspaceCard(ws)).join('')}
      </div>
    `;
        // Bind events
        container.querySelectorAll('.ws-deactivate-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deactivateWorkspace(btn.dataset.id);
            });
        });
        container.querySelectorAll('.ws-view-workflows-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wsId = btn.dataset.wsId;
                Store.set('activeWorkspaceId', wsId);
                Router.navigate('/workflows');
            });
        });
    }
    function renderWorkspaceCard(ws) {
        const name = ws.name || ws.path.split(/[/\\]/).pop() || '未知工作区';
        const activatedTime = ws.activatedAt ? formatTime(ws.activatedAt) : '--';
        const workflowCount = ws.workflowCount || 0;
        const agentCount = ws.agentCount || 0;
        const runningCount = ws.runningWorkflowCount || 0;
        return `
      <div class="card hover-lift" data-id="${ws.id}">
        <div class="card-header">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:8px;height:8px;border-radius:50%;background:var(--accent-green);display:inline-block;flex-shrink:0;"></span>
            <div class="card-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}</div>
          </div>
          ${runningCount > 0 ? `<span class="badge badge-running"><span class="dot"></span> ${runningCount} 运行中</span>` : ''}
        </div>
        <div class="card-body">
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary);margin-bottom:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(ws.path)}">
            ${escapeHtml(ws.path)}
          </div>
          <div style="display:flex;gap:16px;font-size:11px;color:var(--text-muted);margin-bottom:6px;">
            <span>${workflowCount} 个工作流</span>
            <span>${agentCount} 个 Agent</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);">
            激活于 ${activatedTime}
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:12px;">
          <button class="btn btn-sm btn-secondary ws-view-workflows-btn" data-ws-id="${ws.id}">查看工作流</button>
          <button class="btn btn-sm btn-danger ws-deactivate-btn" data-id="${ws.id}" ${workspaces.length <= 1 ? 'disabled title="无法停用最后一个工作区"' : ''}>停用</button>
        </div>
      </div>
    `;
    }
    async function activateWorkspace() {
        if (typeof DirectoryBrowser === 'undefined') {
            Toast.error('目录浏览器组件未加载');
            return;
        }
        DirectoryBrowser.open({
            title: '选择工作区目录',
            onConfirm: async (selectedPath) => {
                if (!selectedPath) {
                    Toast.warning('请选择一个目录');
                    return;
                }
                try {
                    await API.activateWorkspace(selectedPath);
                    Toast.success('工作区已激活');
                    await loadWorkspaces();
                    // Update navbar workspace count
                    updateNavbarWorkspaceCount();
                }
                catch (e) {
                    Toast.error(e.message || '激活工作区失败');
                }
            },
        });
    }
    async function deactivateWorkspace(id) {
        // 禁止停用最后一个工作区
        if (workspaces.length <= 1) {
            Toast.warning('无法停用最后一个工作区，至少需要保留一个活跃工作区');
            return;
        }
        if (!await Modal.confirm('停用工作区', '确定停用此工作区？停用后将从管理平台移除，工作区内的本地文件不会被删除，可随时重新激活。'))
            return;
        try {
            await API.deactivateWorkspace(id);
            // 从本地列表中移除
            workspaces = workspaces.filter(w => w.id !== id);
            Store.set('activeWorkspaces', workspaces);
            renderWorkspaceGrid(workspaces);
            updateNavbarWorkspaceCount();
            Toast.success('工作区已停用');
            WS.emit('workspace.changed', { path: '' });
        }
        catch (e) {
            Toast.error(e.message || '停用工作区失败');
        }
    }
    function updateNavbarWorkspaceCount() {
        const el = document.getElementById('active-workspace-count');
        if (el) {
            el.textContent = String(workspaces.length);
        }
    }
    // ── Helpers ──
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
    function formatTime(isoString) {
        try {
            const date = new Date(isoString);
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${month}-${day} ${hours}:${minutes}`;
        }
        catch (e) {
            return '--';
        }
    }
    return { render };
})();
