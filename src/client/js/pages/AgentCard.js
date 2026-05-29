// ═══════════════════════════════════════════════
// AgentCard Component
// ═══════════════════════════════════════════════

window.AgentCard = (() => {
  function render(agent, options = {}) {
    const lastLog = agent.logs && agent.logs.length > 0
      ? agent.logs[agent.logs.length - 1]
      : null;
    const isChild = options.isChild === true;
    const hasChildren = agent._hasChildren === true;
    const isExpanded = options.isExpanded === true;

    const cardClass = isChild ? 'card card-agent agent-card child-agent-card' : 'card card-agent agent-card hover-lift card-enter';
    const indentStyle = isChild ? 'margin-left:24px;border-left:2px dashed var(--accent-purple);' : '';

    return `
      <div class="${cardClass}" data-id="${agent.id}" data-parent-id="${agent.parentAgentId || ''}" style="${indentStyle}">
        ${!isChild ? `
          <div class="agent-card-expand-toggle" data-agent-id="${agent.id}" title="展开/收起子智能体">
            <span class="expand-icon ${isExpanded ? 'expanded' : ''}">
              ${Icon.svg('chevron-right', 14)}
            </span>
          </div>
        ` : ''}
        <div class="card-header">
          <div>
            <div class="card-title" style="margin-bottom:4px;">${escapeHtml(agent.name)}</div>
            <span class="badge badge-${agent.role || 'custom'}" style="font-size:10px;">${agent.role || 'custom'}</span>
            ${isChild ? '<span class="badge badge-sub" style="font-size:9px;margin-left:4px;">子智能体</span>' : ''}
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
      ${!isChild ? `<div class="agent-children-container" data-parent-id="${agent.id}" style="display:${isExpanded ? 'block' : 'none'};"></div>` : ''}
    `;
  }

  function renderChildCard(agent) {
    return render(agent, { isChild: true });
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  return { render, renderChildCard };
})();
