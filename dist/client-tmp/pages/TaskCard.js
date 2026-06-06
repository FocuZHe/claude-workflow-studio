"use strict";
window.TaskCard = (() => {
    // Cache for workflow and workspace names
    let _workflowNames = {};
    let _workspaceNames = {};
    /**
     * Pre-load workflow and workspace names for task display
     */
    async function loadNames(workflows, workspaces) {
        _workflowNames = {};
        _workspaceNames = {};
        if (Array.isArray(workflows)) {
            workflows.forEach((wf) => { _workflowNames[wf.id] = wf.name; });
        }
        if (Array.isArray(workspaces)) {
            workspaces.forEach((ws) => { _workspaceNames[ws.id] = ws.name || ws.path?.split(/[\\/]/).pop() || '未知'; });
        }
    }
    function render(task, agents = []) {
        const agent = agents.find(a => a.id === task.assignedAgentId);
        const timeAgo = getTimeAgo(task.createdAt);
        const wfName = task.workflowId ? (_workflowNames[task.workflowId] || task.workflowName || null) : null;
        const wsName = task.workspaceId ? (_workspaceNames[task.workspaceId] || task.workspaceName || null) : null;
        // Only show error badge when task has a reference but we have exhausted all lookup methods
        // and confirmed the name is truly unavailable (not just a cache miss)
        const notFound = false;
        return `
      <div class="card card-task task-card hover-lift card-enter" data-id="${task.id}" style="margin-bottom:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
            <div style="min-width:0;flex:1;">
              <div class="card-title" style="font-size:14px;margin-bottom:4px;" title="${escapeAttr(task.title)}">${escapeHtml(task.title)}</div>
              <div style="display:flex;align-items:center;gap:8px;font-size:11px;">
                ${StatusBadge.render(task.status)}
                ${task.status === 'running' ? '<span class="running-indicator"></span>' : ''}
                <span class="badge badge-${task.priority || 'medium'}">${task.priority || 'medium'}</span>
                ${agent ? `<span style="color:var(--text-tertiary);">→ ${escapeHtml(agent.name)}</span>` : ''}
                ${notFound ? '<span class="badge badge-error">工作区或工作流不存在</span>' : ''}
                ${!notFound && wsName ? `<span style="color:var(--text-muted);padding:1px 4px;background:var(--bg-deep);border-radius:3px;" title="工作区">${escapeHtml(wsName)}</span>` : ''}
                ${!notFound && wfName ? `<span style="color:var(--accent-cyan);padding:1px 4px;background:rgba(0,200,255,0.08);border-radius:3px;" title="工作流">${escapeHtml(wfName)}</span>` : ''}
                <span style="color:var(--text-muted);font-family:var(--font-mono);">${timeAgo}</span>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:4px;margin-left:12px;">
            ${task.status === 'pending' ? `<button class="btn btn-sm btn-success btn-execute" title="执行">${Icon.svg('play', 14)}</button>` : ''}
            ${task.status === 'running' ? `<button class="btn btn-sm btn-secondary btn-pause" title="暂停">${Icon.svg('pause', 14)}</button>` : ''}
            ${task.status === 'paused' ? `<button class="btn btn-sm btn-secondary btn-resume" title="继续">${Icon.svg('play', 14)}</button>` : ''}
            ${task.status === 'running' || task.status === 'paused' ? `<button class="btn btn-sm btn-danger btn-cancel" title="取消">${Icon.svg('stop', 14)}</button>` : ''}
            <button class="btn btn-sm btn-danger btn-delete" title="删除">${Icon.svg('close', 14)}</button>
          </div>
        </div>
      </div>
    `;
    }
    function getTimeAgo(dateStr) {
        if (!dateStr)
            return '';
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1)
            return '刚刚';
        if (mins < 60)
            return `${mins}分钟前`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24)
            return `${hrs}小时前`;
        return `${Math.floor(hrs / 24)}天前`;
    }
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
    function escapeAttr(str) {
        return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function updateCardStatus(taskId, newStatus) {
        const card = document.querySelector(`.task-card[data-id="${taskId}"]`);
        if (!card)
            return;
        // Update status badge
        const badgeEl = card.querySelector('.status-badge');
        if (badgeEl) {
            const bc = document.createElement('div');
            bc.innerHTML = StatusBadge.render(newStatus);
            badgeEl.replaceWith(bc.firstElementChild);
        }
        // Update running indicator
        const indicatorEl = card.querySelector('.running-indicator');
        if (newStatus === 'running' && !indicatorEl) {
            const span = document.createElement('span');
            span.className = 'running-indicator';
            const badgeParent = card.querySelector('.status-badge')?.parentElement;
            if (badgeParent)
                badgeParent.insertBefore(span, badgeParent.children[1]);
        }
        else if (newStatus !== 'running' && indicatorEl) {
            indicatorEl.remove();
        }
        // Update buttons
        const btnContainer = card.querySelector('div[style*="margin-left:12px"]');
        if (!btnContainer)
            return;
        let btnsHtml = '';
        if (newStatus === 'pending')
            btnsHtml += `<button class="btn btn-sm btn-success btn-execute" title="执行">${Icon.svg('play', 14)}</button>`;
        if (newStatus === 'running')
            btnsHtml += `<button class="btn btn-sm btn-secondary btn-pause" title="暂停">${Icon.svg('pause', 14)}</button>`;
        if (newStatus === 'paused')
            btnsHtml += `<button class="btn btn-sm btn-secondary btn-resume" title="继续">${Icon.svg('play', 14)}</button>`;
        if (newStatus === 'running' || newStatus === 'paused')
            btnsHtml += `<button class="btn btn-sm btn-danger btn-cancel" title="取消">${Icon.svg('stop', 14)}</button>`;
        btnsHtml += `<button class="btn btn-sm btn-danger btn-delete" title="删除">${Icon.svg('close', 14)}</button>`;
        btnContainer.innerHTML = btnsHtml;
    }
    return { render, updateCardStatus };
})();
