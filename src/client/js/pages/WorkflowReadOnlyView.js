// ═══════════════════════════════════════════════
// WorkflowReadOnlyView — Read-only execution status view
// ═══════════════════════════════════════════════

window.WorkflowReadOnlyView = (() => {
  let _nodes = [];
  let _edges = [];
  let _zoom = 1;
  let _pan = { x: 0, y: 0 };
  let _selectedNodeId = null;
  let _workflow = null;

  const NODE_W = 200;
  const NODE_H = 80;

  // ── Status/Role configs (reused from WorkflowCanvas) ──

  const STATUS_CONFIG = {
    pending:          { color: 'var(--text-muted)',    text: '等待中' },
    waiting:          { color: 'var(--accent-amber)',   text: '等待依赖' },
    running:          { color: 'var(--accent-cyan)',    text: '运行中...' },
    completed:        { color: 'var(--accent-green)',   text: '已完成' },
    failed:           { color: 'var(--accent-red)',     text: '失败' },
    skipped:          { color: '#6b7280',               text: '已跳过' }
  };

  const ROLE_ICONS = {
    start: 'S', end: 'E', agent: 'A', condition: '?',
    developer: '{}', reviewer: 'V', tester: 'T', planner: 'P',
    debugger: 'X', documenter: 'D', parallel: Icon.svg('zap', 12),
    timer: Icon.svg('info', 12), code: '{}', subworkflow: Icon.svg('folder-plus', 12), loop: Icon.svg('refresh', 12)
  };

  const ROLE_COLORS = {
    start: 'var(--accent-green)', end: 'var(--accent-red)',
    agent: 'var(--accent-cyan)', condition: 'var(--accent-amber)',
    developer: 'var(--accent-purple)', reviewer: 'var(--accent-amber)',
    tester: 'var(--accent-green)', planner: 'var(--accent-cyan)',
    debugger: 'var(--accent-red)', documenter: 'var(--accent-amber)',
    parallel: 'var(--accent-amber)',
    timer: 'var(--accent-cyan)',
    code: 'var(--accent-green)', subworkflow: '#8b5cf6', loop: '#f97316'
  };

  // ── Edge path computation (reused from WorkflowCanvas) ──

  function computeEdgePath(src, tgt, edge) {
    const sx = (src.position?.x || 0) + NODE_W;
    const sy = (src.position?.y || 0) + NODE_H / 2;
    const tx = tgt.position?.x || 0;
    const ty = (tgt.position?.y || 0) + NODE_H / 2;

    const dx = Math.abs(tx - sx);
    const cpDist = Math.max(40, dx * 0.35);

    let autoNudge = 0;
    if (!edge?.bendOffset) {
      const corridorLeft = Math.min(sx, tx);
      const corridorRight = Math.max(sx, tx);
      for (const n of _nodes) {
        if (n.id === src.id || n.id === tgt.id) continue;
        const nx = n.position?.x || 0;
        const ny = n.position?.y || 0;
        if (nx + NODE_W <= corridorLeft || nx >= corridorRight) continue;
        const nodeTop = ny - 4;
        const nodeBottom = ny + NODE_H + 4;
        const edgeYAtNode = sy + (ty - sy) * ((nx + NODE_W / 2 - sx) / (tx - sx || 1));
        if (edgeYAtNode > nodeTop && edgeYAtNode < nodeBottom) {
          const nudgeUp = edgeYAtNode - nodeTop;
          const nudgeDown = nodeBottom - edgeYAtNode;
          const needed = nudgeUp < nudgeDown ? -nudgeUp - 6 : nudgeDown + 6;
          if (Math.abs(needed) > Math.abs(autoNudge)) autoNudge = needed;
        }
      }
    }

    const bend = edge?.bendOffset || autoNudge;
    const cp1x = sx + cpDist;
    const cp1y = sy + bend;
    const cp2x = tx - cpDist;
    const cp2y = ty + bend;
    const d = `M${sx},${sy} C${cp1x},${cp1y} ${cp2x},${cp2y} ${tx},${ty}`;

    const t = 0.5;
    const mx = (1-t)*(1-t)*(1-t)*sx + 3*(1-t)*(1-t)*t*cp1x + 3*(1-t)*t*t*cp2x + t*t*t*tx;
    const my = (1-t)*(1-t)*(1-t)*sy + 3*(1-t)*(1-t)*t*cp1y + 3*(1-t)*t*t*cp2y + t*t*t*ty;

    return { d, mx, my };
  }

  // ── Render ──

  function render(workflow) {
    _workflow = workflow;
    _nodes = workflow ? [...(workflow.nodes || [])] : [];
    _edges = workflow ? [...(workflow.edges || [])] : [];
    _zoom = 1;
    _pan = { x: 0, y: 0 };
    _selectedNodeId = null;

    // Reset stale 'running' status if workflow has no active runId
    if (workflow?.executionStatus === 'running' && !workflow?.currentRunId) {
      _workflow.executionStatus = 'idle';
      _nodes = _nodes.map(n => n.status === 'running' ? { ...n, status: 'pending', startedAt: null } : n);
    }

    const status = _workflow?.executionStatus || _workflow?.status || 'pending';
    const completedCount = _nodes.filter(n => n.status === 'completed').length;
    const failedCount = _nodes.filter(n => n.status === 'failed').length;
    const runningCount = _nodes.filter(n => n.status === 'running').length;
    const progressPercent = _nodes.length > 0 ? Math.round((completedCount / _nodes.length) * 100) : 0;

    return `
      <div style="display:flex;flex-direction:column;height:100%;">
        <!-- Toolbar -->
        <div class="ro-toolbar" style="display:flex;align-items:center;gap:16px;padding:10px 16px;background:var(--bg-secondary);border:1px solid var(--border-subtle);border-radius:var(--border-radius-md);margin-bottom:8px;flex-shrink:0;">
          <span style="font-size:14px;font-weight:600;color:var(--text-primary);">${escapeXml(workflow?.name || '工作流')}</span>
          ${StatusBadge.render(status)}
          ${runningCount > 0 ? '<span class="running-indicator"></span>' : ''}
          <div style="flex:1;display:flex;align-items:center;gap:8px;">
            <div style="width:120px;height:6px;background:var(--bg-tertiary);border-radius:3px;overflow:hidden;">
              <div class="ro-progress-fill" style="width:${progressPercent}%;height:100%;background:${failedCount > 0 ? 'var(--accent-red)' : 'var(--accent-green)'};border-radius:3px;transition:width 0.5s;"></div>
            </div>
            <span class="ro-progress-text" style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">${completedCount}/${_nodes.length} (${progressPercent}%)</span>
            ${failedCount > 0 ? `<span style="font-size:11px;color:var(--accent-red);">${failedCount} 失败</span>` : ''}
          </div>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-sm btn-secondary ro-zoom-in" title="放大">+</button>
            <button class="btn btn-sm btn-secondary ro-zoom-out" title="缩小">-</button>
            <button class="btn btn-sm btn-secondary ro-zoom-reset" title="重置缩放">1:1</button>
          </div>
          <button class="btn btn-sm btn-primary ro-goto-edit">跳转到编辑</button>
        </div>
        <!-- Canvas -->
        <div style="flex:1;position:relative;min-height:0;">
          <div id="ro-canvas-container" style="width:100%;height:100%;background:var(--bg-deep);border:1px solid var(--border-subtle);border-radius:var(--border-radius-lg);overflow:hidden;position:relative;cursor:grab;">
            <svg id="ro-svg" width="100%" height="100%" style="display:block;">
              <defs>
                <marker id="ro-arrowhead" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto">
                  <polygon points="0 0, 12 4, 0 8" fill="var(--accent-cyan)" />
                </marker>
                <marker id="ro-arrowhead-running" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto">
                  <polygon points="0 0, 12 4, 0 8" fill="var(--accent-cyan)" />
                </marker>
                <marker id="ro-arrowhead-completed" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto">
                  <polygon points="0 0, 12 4, 0 8" fill="var(--accent-green)" />
                </marker>
                <marker id="ro-arrowhead-failed" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto">
                  <polygon points="0 0, 12 4, 0 8" fill="var(--accent-red)" />
                </marker>
              </defs>
              <g id="ro-canvas-group" transform="translate(0,0) scale(1)">
                <g id="ro-edges-layer"></g>
                <g id="ro-nodes-layer"></g>
              </g>
            </svg>
            <div style="position:absolute;bottom:8px;right:8px;font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">
              ${_nodes.length} 个节点 | 只读模式
            </div>
          </div>
          <!-- Detail panel -->
          <div id="ro-detail-panel"></div>
        </div>
      </div>
    `;
  }

  // ── Init (bind events, render SVG) ──

  function init(workflow, options = {}) {
    _workflow = workflow;
    _nodes = workflow ? [...(workflow.nodes || [])] : [];
    _edges = workflow ? [...(workflow.edges || [])] : [];
    _zoom = 1;
    _pan = { x: 0, y: 0 };
    _selectedNodeId = null;

    renderEdges();
    renderNodes();
    initCanvas();

    // Bind toolbar events
    document.querySelector('.ro-zoom-in')?.addEventListener('click', () => zoom(1.2));
    document.querySelector('.ro-zoom-out')?.addEventListener('click', () => zoom(0.8));
    document.querySelector('.ro-zoom-reset')?.addEventListener('click', zoomReset);
    document.querySelector('.ro-goto-edit')?.addEventListener('click', () => {
      if (options.onGotoEdit) options.onGotoEdit(workflow?.id);
    });
  }

  // ── Render Nodes ──

  function renderNodes() {
    const layer = document.getElementById('ro-nodes-layer');
    if (!layer) return;

    layer.innerHTML = _nodes.map(node => {
      const x = node.position?.x || 0;
      const y = node.position?.y || 0;
      const status = node.status || 'pending';
      const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
      const roleIcon = ROLE_ICONS[node.type] || ROLE_ICONS.agent;
      const roleColor = ROLE_COLORS[node.type] || ROLE_COLORS.agent;
      const nodeType = node.type || 'agent';

      return `
        <g class="wf-node ro-node" data-id="${node.id}" transform="translate(${x},${y})" style="cursor:pointer;">
          <rect width="${NODE_W}" height="3" rx="2" fill="${statusCfg.color}"/>
          <rect y="3" width="${NODE_W}" height="77" rx="8" fill="var(--bg-secondary)" stroke="${statusCfg.color}" stroke-width="1.5"/>
          <circle cx="20" cy="38" r="14" fill="${roleColor}" opacity="0.15"/>
          ${roleIcon.startsWith('<svg') ? `<foreignObject x="8" y="26" width="24" height="24"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;color:${roleColor};">${roleIcon}</div></foreignObject>` : `<text x="20" y="43" text-anchor="middle" font-size="12" font-weight="700" fill="${roleColor}" font-family="var(--font-mono)">${escapeXml(roleIcon)}</text>`}
          <text x="42" y="32" font-size="12" font-weight="600" fill="var(--text-primary)" font-family="var(--font-sans)">${escapeXml(truncate(node.label || nodeType, 14))}</text>
          <text x="42" y="48" font-size="10" fill="${statusCfg.color}" font-family="var(--font-mono)">${statusCfg.text}</text>
          <text x="12" y="66" font-size="9" fill="var(--text-muted)" font-family="var(--font-sans)">${escapeXml(truncate(node.output || '', 28))}</text>
          <circle cx="0" cy="40" r="6" fill="var(--bg-deep)" stroke="var(--accent-cyan)" stroke-width="2"/>
          <circle cx="${NODE_W}" cy="40" r="6" fill="var(--accent-green)" stroke="var(--accent-green)" stroke-width="2"/>
          <circle cx="${NODE_W - 12}" cy="14" r="4" fill="${statusCfg.color}">
            ${status === 'running' ? '<animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/>' : ''}
          </circle>
        </g>
      `;
    }).join('');

    // Click to show readonly detail
    layer.querySelectorAll('.ro-node').forEach(el => {
      el.addEventListener('click', () => showNodeDetail(el.dataset.id));
    });
  }

  // ── Render Edges ──

  function renderEdges() {
    const layer = document.getElementById('ro-edges-layer');
    if (!layer) return;

    layer.innerHTML = _edges.map(edge => {
      const src = _nodes.find(n => n.id === edge.source);
      const tgt = _nodes.find(n => n.id === edge.target);
      if (!src || !tgt) return '';

      const { d, mx, my } = computeEdgePath(src, tgt, edge);

      const edgeStatus = (src.status === 'running' || tgt.status === 'running') ? 'running' :
                         (src.status === 'completed' && tgt.status === 'completed') ? 'completed' :
                         (src.status === 'failed' || tgt.status === 'failed') ? 'failed' : '';
      const strokeColor = edgeStatus === 'running' ? 'var(--accent-cyan)' :
                           edgeStatus === 'completed' ? 'var(--accent-green)' :
                           edgeStatus === 'failed' ? 'var(--accent-red)' :
                           'var(--accent-cyan-dim)';
      const markerId = edgeStatus ? `ro-arrowhead-${edgeStatus}` : 'ro-arrowhead';
      const dashAttr = edgeStatus === 'running' ? 'stroke-dasharray="8 4"' : '';

      return `
        <g class="wf-edge ${edgeStatus}">
          <path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="2" marker-end="url(#${markerId})" opacity="0.8" ${dashAttr}/>
          ${edge.label ? `
            <g class="edge-label" transform="translate(${mx},${my - 8})">
              <rect x="-4" y="-11" width="${edge.label.length * 7 + 8}" height="15" rx="3" fill="var(--bg-secondary)" stroke="var(--border-subtle)" stroke-width="0.5" opacity="0.9" transform="translate(-${(edge.label.length * 7 + 8) / 2}, 0)"/>
              <text text-anchor="middle" dy="-1" fill="var(--text-secondary)" font-size="10" font-family="var(--font-mono)">${escapeXml(edge.label)}</text>
            </g>
          ` : ''}
        </g>
      `;
    }).join('');
  }

  // ── Canvas interaction (pan & zoom only) ──

  function initCanvas() {
    const container = document.getElementById('ro-canvas-container');
    if (!container) return;
    const svgEl = document.getElementById('ro-svg');
    let isPanning = false;
    let panStart = { x: 0, y: 0 };

    container.addEventListener('mousedown', (e) => {
      if (e.target === svgEl || e.target === container || e.target.tagName === 'svg') {
        isPanning = true;
        panStart = { x: e.clientX - _pan.x, y: e.clientY - _pan.y };
        container.style.cursor = 'grabbing';
      }
    });

    const onMouseMove = (e) => {
      if (isPanning) {
        _pan = { x: e.clientX - panStart.x, y: e.clientY - panStart.y };
        updateTransform();
      }
    };

    const onMouseUp = () => {
      isPanning = false;
      container.style.cursor = 'grab';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 0.9 : 1.1);
    });

    // Store cleanup refs
    container._roCleanup = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }

  function updateTransform() {
    const g = document.getElementById('ro-canvas-group');
    if (g) g.setAttribute('transform', `translate(${_pan.x},${_pan.y}) scale(${_zoom})`);
  }

  function zoom(factor) {
    _zoom = Math.max(0.3, Math.min(3, _zoom * factor));
    updateTransform();
  }

  function zoomReset() {
    _zoom = 1;
    _pan = { x: 0, y: 0 };
    updateTransform();
  }

  // ── Node Detail (read-only) ──

  function showNodeDetail(nodeId) {
    _selectedNodeId = nodeId;
    const node = _nodes.find(n => n.id === nodeId);
    if (!node) return;

    const status = node.status || 'pending';
    const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;

    let panel = document.getElementById('ro-detail-panel');
    if (!panel) return;
    panel.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:320px;background:var(--bg-secondary);border-left:1px solid var(--border-subtle);overflow-y:auto;z-index:50;border-radius:0 var(--border-radius-lg) var(--border-radius-lg) 0;box-shadow:-4px 0 16px rgba(0,0,0,0.2);';

    panel.innerHTML = `
      <div style="padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="font-size:14px;font-weight:600;margin:0;">${escapeXml(node.label)}</h3>
          <button class="btn btn-sm btn-ghost ro-close-detail" style="font-size:16px;line-height:1;">${Icon.svg('close', 16)}</button>
        </div>
        <div class="form-group">
          <div class="form-label">状态</div>
          <span class="badge badge-${status}">${statusCfg.text}</span>
        </div>
        <div class="form-group">
          <div class="form-label">类型</div>
          <span style="font-size:12px;color:var(--text-secondary);">${escapeXml(node.type || 'agent')}</span>
        </div>
        ${node.agentId ? `<div class="form-group"><div class="form-label">Agent ID</div><div style="font-family:var(--font-mono);font-size:11px;">${escapeXml(node.agentId)}</div></div>` : ''}
        ${node.startedAt ? `<div class="form-group"><div class="form-label">开始时间</div><div style="font-size:12px;">${new Date(node.startedAt).toLocaleString()}</div></div>` : ''}
        ${node.completedAt ? `<div class="form-group"><div class="form-label">完成时间</div><div style="font-size:12px;">${new Date(node.completedAt).toLocaleString()}</div></div>` : ''}
        ${node.output ? `
          <div class="form-group">
            <div class="form-label">输出</div>
            <div style="background:var(--bg-deep);padding:8px;border-radius:4px;font-size:12px;font-family:var(--font-mono);word-break:break-word;max-height:200px;overflow-y:auto;">
              ${escapeXml(node.output)}
            </div>
          </div>
        ` : ''}
        ${(node.logs && node.logs.length > 0) ? `
          <div class="form-group">
            <div class="form-label">日志 (${node.logs.length})</div>
            <div class="log-viewer" style="max-height:200px;">
              ${node.logs.map(log => `
                <div class="log-entry">
                  <span class="log-timestamp">${new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span class="log-level ${log.level}">${log.level}</span>
                  <span class="log-message">${escapeXml(log.message)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    document.querySelector('.ro-close-detail')?.addEventListener('click', hideNodeDetail);
  }

  function hideNodeDetail() {
    _selectedNodeId = null;
    const panel = document.getElementById('ro-detail-panel');
    if (panel) {
      panel.innerHTML = '';
      panel.style.cssText = '';
    }
  }

  // ── Update execution data (for live updates) ──

  function updateExecutionData(executionData) {
    if (!executionData?.nodes) return;
    for (const nodeData of executionData.nodes) {
      const node = _nodes.find(n => n.id === nodeData.nodeId);
      if (node) {
        node.status = nodeData.status;
        node.output = nodeData.output;
        node.startedAt = nodeData.startedAt;
        node.completedAt = nodeData.completedAt;
        node.logs = nodeData.logs || [];
      }
    }
    renderEdges();
    renderNodes();

    // Update progress in toolbar
    const completedCount = _nodes.filter(n => n.status === 'completed').length;
    const failedCount = _nodes.filter(n => n.status === 'failed').length;
    const progressPercent = _nodes.length > 0 ? Math.round((completedCount / _nodes.length) * 100) : 0;
    const fillEl = document.querySelector('.ro-progress-fill');
    const textEl = document.querySelector('.ro-progress-text');
    if (fillEl) fillEl.style.width = progressPercent + '%';
    if (textEl) textEl.textContent = `${completedCount}/${_nodes.length} (${progressPercent}%)`;

    if (_selectedNodeId) showNodeDetail(_selectedNodeId);
  }

  // ── Cleanup ──

  function cleanup() {
    hideNodeDetail();
    const container = document.getElementById('ro-canvas-container');
    if (container?._roCleanup) container._roCleanup();
  }

  // ── Helpers ──

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '...' : str;
  }

  function escapeXml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    render, init, cleanup, updateExecutionData, zoom, zoomReset
  };
})();
