// ═══════════════════════════════════════════════
// AgentCard Component
// ═══════════════════════════════════════════════

window.AgentCard = (() => {
  function render(agent) {
    const lastLog = agent.logs && agent.logs.length > 0
      ? agent.logs[agent.logs.length - 1]
      : null;

    return `
      <div class="card card-agent agent-card hover-lift card-enter" data-id="${agent.id}">
        <div class="card-header">
          <div>
            <div class="card-title" style="margin-bottom:4px;">${escapeHtml(agent.name)}</div>
            <span class="badge badge-${agent.role || 'custom'}" style="font-size:10px;">${agent.role || 'custom'}</span>
          </div>
          ${StatusBadge.render(agent.status)}
        </div>
        <div class="card-body">
          <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:8px;min-height:32px;">
            ${agent.description ? escapeHtml(agent.description).substring(0, 80) : '暂无描述'}
          </div>
          ${lastLog ? `
            <div class="log-entry" style="font-size:10px;padding:4px 6px;background:var(--bg-deep);border-radius:4px;">
              <span class="log-level ${lastLog.level}" style="font-size:9px;">${lastLog.level}</span>
              <span class="log-message" style="font-size:11px;">${escapeHtml(lastLog.message).substring(0, 50)}</span>
            </div>
          ` : ''}
        </div>
        <div style="display:flex;gap:6px;margin-top:12px;">
          <button class="btn btn-sm btn-secondary btn-edit" title="编辑">${Icon.svg('edit', 14)}</button>
          <button class="btn btn-sm btn-danger btn-delete" title="删除">${Icon.svg('delete', 14)}</button>
        </div>
      </div>
    `;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  return { render };
})();
