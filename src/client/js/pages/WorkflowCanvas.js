// ═══════════════════════════════════════════════
// WorkflowCanvas — Puzzle-style SVG canvas
// ═══════════════════════════════════════════════

window.WorkflowCanvas = (() => {
  let nodes = [];
  let edges = [];
  let svgEl = null;
  let dragging = null;
  let dragOffset = { x: 0, y: 0 };
  let connecting = null;
  let panOffset = { x: 0, y: 0 };
  let zoom = 1;
  let nextNodeId = 1;
  let selectedNodeId = null;
  let selectedEdgeId = null;
  let draggingEdge = null;
  let dragAnimFrame = null;
  let breakpoints = new Set();
  let _wsUnsubs = [];
  let _focusMode = false;
  let _currentWorkflow = null;
  let _onWindowMouseMove = null;
  let _onWindowMouseUp = null;
  let _onEdit = null;

  const NODE_W = 200;
  const NODE_H = 80;

  const STATUS_CONFIG = {
    pending:          { color: 'var(--text-muted)',    text: '等待中' },
    waiting:          { color: 'var(--accent-amber)',   text: '等待依赖' },
    running:          { color: 'var(--accent-cyan)',    text: '运行中...' },
    completed:        { color: 'var(--accent-green)',   text: '已完成' },
    failed:           { color: 'var(--accent-red)',     text: '失败' },
    skipped:          { color: '#6b7280',               text: '已跳过' }
  };

  const ROLE_ICONS = {
    start: 'S',
    end: 'E',
    agent: 'A',
    approval: '✓',
    developer: '{}',
    reviewer: 'V',
    tester: 'T',
    planner: 'P',
    debugger: 'X',
    documenter: 'D',
    parallel: Icon.svg('zap', 12),
    subworkflow: Icon.svg('folder-plus', 12),
  };

  const ROLE_COLORS = {
    start: 'var(--accent-green)',
    end: 'var(--accent-red)',
    agent: 'var(--accent-cyan)',
    approval: 'var(--accent-amber)',
    developer: 'var(--accent-purple)',
    reviewer: 'var(--accent-amber)',
    tester: 'var(--accent-green)',
    planner: 'var(--accent-cyan)',
    debugger: 'var(--accent-red)',
    documenter: 'var(--accent-amber)',
    parallel: 'var(--accent-amber)',
    subworkflow: '#8b5cf6',
  };

  // Node type definitions for the add-node modal
  const NODE_TYPES = [
    { type: 'agent',    label: '智能体',     icon: 'A', color: 'var(--accent-cyan)' },
    { type: 'parallel', label: '并行处理',   icon: Icon.svg('zap', 12), color: 'var(--accent-amber)' },
    { type: 'subworkflow', label: '子工作流', icon: Icon.svg('folder-plus', 12), color: '#8b5cf6' },
    { type: 'approval', label: '人工审核',   icon: '✓', color: 'var(--accent-amber)' },
  ];

  // ── Render ──

  function render(workflow) {
    nodes = workflow ? [...(workflow.nodes || [])] : [];
    edges = workflow ? [...(workflow.edges || [])] : [];
    nextNodeId = nodes.length + 1;

    return `
      <div id="canvas-container" style="width:100%;flex:1;min-height:0;background:var(--bg-deep);border:1px solid var(--border-subtle);border-radius:var(--border-radius-lg);overflow:hidden;position:relative;cursor:grab;">
        <svg id="wf-svg" width="100%" height="100%" style="display:block;">
          <defs>
            <marker id="arrowhead" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto">
              <polygon points="0 0, 12 4, 0 8" fill="var(--accent-cyan)" />
            </marker>
            <marker id="arrowhead-running" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto">
              <polygon points="0 0, 12 4, 0 8" fill="var(--accent-cyan)" />
            </marker>
            <marker id="arrowhead-completed" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto">
              <polygon points="0 0, 12 4, 0 8" fill="var(--accent-green)" />
            </marker>
            <marker id="arrowhead-failed" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto">
              <polygon points="0 0, 12 4, 0 8" fill="var(--accent-red)" />
            </marker>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
          <g id="canvas-group" transform="translate(0,0) scale(1)">
            <g id="edges-layer"></g>
            <g id="nodes-layer"></g>
          </g>
        </svg>
        <div style="position:absolute;bottom:8px;right:8px;font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">
          ${nodes.length} 个节点 | ${edges.length} 条边 | 缩放: ${(zoom * 100).toFixed(0)}%
        </div>
      </div>
    `;
  }

  // ── Init ──

  // ── Claude Stream Live Output ──

  let _currentWorkflowId = null;

  function onClaudeStream(payload) {
    // Only handle events for the current workflow
    if (!_currentWorkflowId || payload.workflowId !== _currentWorkflowId) return;

    const nodeEl = document.querySelector(`[data-node-id="${payload.nodeId}"]`);
    // In SVG, query by data-id on the g.wf-node group
    const svgNodeEl = document.querySelector(`g.wf-node[data-id="${payload.nodeId}"]`);
    const targetEl = svgNodeEl || nodeEl;
    if (!targetEl) return;

    // Find or create the output display overlay (HTML div positioned over SVG)
    const canvasContainer = document.getElementById('canvas-container');
    if (!canvasContainer) return;

    let outputEl = canvasContainer.querySelector(`.node-live-output[data-node-id="${payload.nodeId}"]`);
    if (!outputEl) {
      outputEl = document.createElement('div');
      outputEl.className = 'node-live-output';
      outputEl.setAttribute('data-node-id', payload.nodeId);
      outputEl.style.cssText = `
        position:absolute;max-height:60px;overflow:hidden;font-size:10px;
        font-family:var(--font-mono);color:var(--accent-amber);
        background:rgba(0,0,0,0.85);padding:3px 6px;
        border-radius:0 0 var(--border-radius) var(--border-radius);
        pointer-events:none;white-space:nowrap;text-overflow:ellipsis;
        z-index:20;box-shadow:0 2px 8px rgba(0,0,0,0.4);
        max-width:${NODE_W}px;
      `;
      canvasContainer.appendChild(outputEl);
    }

    // Position the overlay relative to the node
    const nodeData = nodes.find(n => n.id === payload.nodeId);
    if (nodeData) {
      const nodeX = (nodeData.position?.x || 0) * zoom + panOffset.x;
      const nodeY = (nodeData.position?.y || 0) * zoom + panOffset.y + NODE_H * zoom;
      outputEl.style.left = nodeX + 'px';
      outputEl.style.top = nodeY + 'px';
      outputEl.style.width = (NODE_W * zoom) + 'px';
    }

    // Append chunk (keep last 200 chars)
    const existing = outputEl.getAttribute('data-buffer') || '';
    const newBuffer = (existing + (payload.chunk || '')).slice(-200);
    outputEl.setAttribute('data-buffer', newBuffer);
    outputEl.textContent = newBuffer.replace(/\n/g, ' ').trim();

    // On complete, fade out and remove
    if (payload.isComplete) {
      setTimeout(() => {
        if (outputEl.parentNode) {
          outputEl.style.transition = 'opacity 0.5s';
          outputEl.style.opacity = '0';
          setTimeout(() => outputEl.remove(), 500);
        }
      }, 3000);
    }
  }

  function removeLiveOutputOverlays() {
    const canvasContainer = document.getElementById('canvas-container');
    if (!canvasContainer) return;
    canvasContainer.querySelectorAll('.node-live-output').forEach(el => el.remove());
  }

  function init(workflow) {
    // Clean up previous WS listeners
    _wsUnsubs.forEach(fn => fn());
    _wsUnsubs = [];

    svgEl = document.getElementById('wf-svg');
    if (!svgEl) return;

    _currentWorkflow = workflow;
    _currentWorkflowId = workflow?.id || null;

    renderAll();

    const container = document.getElementById('canvas-container');

    // Pan
    let isPanning = false;
    let panStart = { x: 0, y: 0 };

    container.addEventListener('mousedown', (e) => {
      if (!e.target.closest('#wf-delete-toolbar')) {
        hideDeleteToolbar();
      }
      if (e.target === svgEl || e.target === container || e.target.tagName === 'svg') {
        if (connecting) {
          cancelConnecting();
          return;
        }
        // Deselect edge when clicking empty canvas
        if (selectedEdgeId) {
          selectedEdgeId = null;
          renderEdges();
        }
        isPanning = true;
        panStart = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
        container.style.cursor = 'grabbing';
      }
    });

    // Clean up any previous window listeners before adding new ones
    if (_onWindowMouseMove) window.removeEventListener('mousemove', _onWindowMouseMove);
    if (_onWindowMouseUp) window.removeEventListener('mouseup', _onWindowMouseUp);

    _onWindowMouseMove = (e) => {
      if (isPanning) {
        panOffset = { x: e.clientX - panStart.x, y: e.clientY - panStart.y };
        updateTransform();
      }
      if (dragging) {
        if (dragAnimFrame) return;
        dragAnimFrame = requestAnimationFrame(() => {
          const rect = svgEl.getBoundingClientRect();
          const x = (e.clientX - rect.left - panOffset.x) / zoom - dragOffset.x;
          const y = (e.clientY - rect.top - panOffset.y) / zoom - dragOffset.y;
          const node = nodes.find(n => n.id === dragging);
          if (node) {
            node.position = { x: Math.max(0, x), y: Math.max(0, y) };
            _onEdit?.();
            renderAll();
          }
          dragAnimFrame = null;
        });
      }
      if (draggingEdge) {
        if (dragAnimFrame) return;
        dragAnimFrame = requestAnimationFrame(() => {
          const rect = svgEl.getBoundingClientRect();
          const currentY = (e.clientY - rect.top - panOffset.y) / zoom;
          const deltaY = currentY - draggingEdge.startY;
          const edge = edges.find(ed => ed.id === draggingEdge.id);
          if (edge) {
            edge.bendOffset = draggingEdge.startBend + deltaY;
            draggingEdge.didDrag = true;
            _onEdit?.();
            renderEdges();
          }
          dragAnimFrame = null;
        });
      }
      if (connecting) {
        drawTempConnection(e);
      }
    };

    _onWindowMouseUp = () => {
      isPanning = false;
      dragging = null;
      // Delay clearing draggingEdge so the click handler can check didDrag
      setTimeout(() => { draggingEdge = null; }, 10);
      if (container) container.style.cursor = 'grab';
    };

    window.addEventListener('mousemove', _onWindowMouseMove);
    window.addEventListener('mouseup', _onWindowMouseUp);

    // Zoom
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoom = Math.max(0.3, Math.min(3, zoom * delta));
      updateTransform();
    });

    // Keyboard: Delete selected node
    window.addEventListener('keydown', handleKeyDown);

    // Listen for Claude stream events to show live output on nodes
    _wsUnsubs.push(WS.on('claude.stream', onClaudeStream));

    // Snapshot buttons
    document.getElementById('canvas-snapshot-btn')?.addEventListener('click', saveSnapshot);
    document.getElementById('canvas-snapshot-list-btn')?.addEventListener('click', showSnapshotList);

    // Focus mode
    document.getElementById('canvas-focus-btn')?.addEventListener('click', toggleFocusMode);

    // Drag-drop files
    initDragDrop();
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (connecting) { cancelConnecting(); return; }
      if (selectedEdgeId) { selectedEdgeId = null; renderEdges(); return; }
      if (selectedNodeId) { hideNodeDetail(); return; }
    }
    if (e.key === 'Delete') {
      const itemType = selectedNodeId ? '节点' : selectedEdgeId ? '连线' : null;
      if (!itemType) return;

      Modal.confirm('删除确认', `确定删除选中的${itemType}？`).then(confirmed => {
        if (!confirmed) return;
        if (selectedNodeId) {
          nodes = nodes.filter(n => n.id !== selectedNodeId);
          edges = edges.filter(ed => ed.source !== selectedNodeId && ed.target !== selectedNodeId);
          hideNodeDetail();
          _onEdit?.();
          renderAll();
        } else if (selectedEdgeId) {
          edges = edges.filter(ed => ed.id !== selectedEdgeId);
          selectedEdgeId = null;
          _onEdit?.();
          renderAll();
        }
      });
    }
  }

  // ── Transform ──

  function updateTransform() {
    const g = document.getElementById('canvas-group');
    if (g) g.setAttribute('transform', `translate(${panOffset.x},${panOffset.y}) scale(${zoom})`);
  }

  // ── Render All ──

  function renderAll() {
    renderEdges();
    renderNodes();
    updateStatusBar();
  }

  function updateStatusBar() {
    const container = document.getElementById('canvas-container');
    if (!container) return;
    const bar = container.querySelector(':scope > div:last-child');
    if (bar) {
      bar.textContent = `${nodes.length} 个节点 | ${edges.length} 条边 | 缩放: ${(zoom * 100).toFixed(0)}%`;
    }
  }

  // ── Render Nodes ──

  function renderNodes() {
    const layer = document.getElementById('nodes-layer');
    if (!layer) return;

    layer.innerHTML = nodes.map(node => {
      const x = node.position?.x || 0;
      const y = node.position?.y || 0;
      const status = node.status || 'pending';
      const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
      const roleIcon = ROLE_ICONS[node.type] || ROLE_ICONS.agent;
      const roleColor = ROLE_COLORS[node.type] || ROLE_COLORS.agent;
      const nodeType = node.type || 'agent';
      const isSelected = selectedNodeId === node.id;

      return `
        <g class="wf-node" data-id="${node.id}" data-status="${status}" transform="translate(${x},${y})" style="cursor:move;">
          <!-- Status top bar -->
          <rect class="wf-node-status-bar" width="${NODE_W}" height="3" rx="2" fill="${statusCfg.color}"/>

          <!-- Main body background -->
          <rect y="3" width="${NODE_W}" height="77" rx="8" fill="var(--bg-secondary)" stroke="${isSelected ? 'var(--accent-cyan)' : statusCfg.color}" stroke-width="${isSelected ? 2.5 : 1.5}"/>

          <!-- Role icon circle -->
          <circle cx="20" cy="38" r="14" fill="${roleColor}" opacity="0.15"/>
          ${roleIcon.startsWith('<svg') ? `<foreignObject x="8" y="26" width="24" height="24"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;color:${roleColor};">${roleIcon}</div></foreignObject>` : `<text x="20" y="43" text-anchor="middle" font-size="12" font-weight="700" fill="${roleColor}" font-family="var(--font-mono)">${escapeXml(roleIcon)}</text>`}

          <!-- Node label (truncated) -->
          <text x="42" y="32" font-size="12" font-weight="600" fill="var(--text-primary)" font-family="var(--font-sans)">
            ${escapeXml(truncate(node.label || nodeType, 14))}
          </text>

          <!-- Status text -->
          <text x="42" y="48" font-size="10" fill="${statusCfg.color}" font-family="var(--font-mono)">
            ${statusCfg.text}
          </text>

          <!-- Output summary (truncated) -->
          <text x="12" y="66" font-size="9" fill="var(--text-muted)" font-family="var(--font-sans)">
            ${escapeXml(truncate(node.output || '', 28))}
          </text>

          <!-- Input port (left) -->
          <circle cx="0" cy="40" r="${connecting ? 7 : 6}"
                  fill="${connecting ? 'var(--accent-cyan)' : 'var(--bg-deep)'}"
                  stroke="var(--accent-cyan)" stroke-width="${connecting ? 3 : 2}"
                  class="port-in" data-node="${node.id}"
                  style="cursor:${connecting ? 'crosshair' : 'default'};"
                  opacity="${connecting && connecting.source === node.id ? 0.3 : 1}"/>

          <!-- Output port (right) -->
          <circle cx="${NODE_W}" cy="40" r="${connecting && connecting.source === node.id ? 8 : 6}"
                  fill="${connecting && connecting.source === node.id ? 'var(--accent-amber)' : 'var(--accent-green)'}"
                  stroke="${connecting && connecting.source === node.id ? 'var(--accent-amber)' : 'var(--accent-green)'}"
                  stroke-width="2"
                  class="port-out" data-node="${node.id}" style="cursor:crosshair;"/>

          <!-- Status indicator dot (top-right) -->
          <circle cx="${NODE_W - 12}" cy="14" r="4" fill="${statusCfg.color}" class="wf-status-dot">
            ${status === 'running' ? '<animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/>' : ''}
          </circle>

          ${breakpoints.has(node.id) ? `
            <!-- Breakpoint indicator (top-left) -->
            <circle cx="12" cy="14" r="5" fill="var(--accent-red)" stroke="#fff" stroke-width="1.5" class="wf-breakpoint-dot">
              <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite"/>
            </circle>
          ` : ''}
        </g>
      `;
    }).join('');

    bindNodeEvents();
  }

  // ── Bind Node Events ──

  function cancelConnecting() {
    connecting = null;
    removeTempConnection();
    renderAll();
  }

  function bindNodeEvents() {
    const layer = document.getElementById('nodes-layer');
    if (!layer) return;

    layer.querySelectorAll('.wf-node').forEach(el => {
      // Output port click: start connection mode
      el.querySelector('.port-out')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const nodeId = el.dataset.id;
        if (connecting && connecting.source === nodeId) {
          // Clicking same port again cancels
          cancelConnecting();
        } else {
          connecting = { source: nodeId };
          renderAll(); // Re-render to highlight the port
        }
      });

      // Input port click: complete connection
      el.querySelector('.port-in')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!connecting) return;
        const targetId = el.dataset.id;
        if (connecting.source !== targetId) {
          const exists = edges.some(ed => ed.source === connecting.source && ed.target === targetId);
          if (!exists) {
            const newEdge = {
              id: 'e' + Date.now(),
              source: connecting.source,
              target: targetId,
            };
            edges.push(newEdge);
            _onEdit?.();

          }
        }
        connecting = null;
        removeTempConnection();
        renderAll();
      });

      // Node body: drag (only if not in connecting mode)
      el.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('port-in') || e.target.classList.contains('port-out')) return;
        if (connecting) {
          cancelConnecting();
          return;
        }
        const node = nodes.find(n => n.id === el.dataset.id);
        if (node) {
          const rect = svgEl.getBoundingClientRect();
          const mouseX = (e.clientX - rect.left - panOffset.x) / zoom;
          const mouseY = (e.clientY - rect.top - panOffset.y) / zoom;
          dragOffset = {
            x: mouseX - (node.position?.x || 0),
            y: mouseY - (node.position?.y || 0)
          };
        }
        dragging = el.dataset.id;
        e.stopPropagation();
      });

      // Click to show detail panel and delete toolbar (only if not connecting and not dragging)
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('port-in') || e.target.classList.contains('port-out')) return;
        if (connecting) return;

        // Show delete toolbar above the node
        const nodeData = nodes.find(n => n.id === el.dataset.id);
        if (nodeData) {
          const nx = (nodeData.position?.x || 0) * zoom + panOffset.x + NODE_W * zoom / 2;
          const ny = (nodeData.position?.y || 0) * zoom + panOffset.y;
          showDeleteToolbar('node', el.dataset.id, nx, ny);
        }
        showNodeDetail(el.dataset.id);

        // Show error detail panel for failed nodes
        if (nodeData && nodeData.status === 'failed') {
          showErrorDetailPanel(el.dataset.id);
        }
      });

      // Right-click context menu
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showNodeContextMenu(el.dataset.id, e.clientX, e.clientY);
      });
    });
  }

  // ── Temporary Connection Line ──

  function drawTempConnection(e) {
    removeTempConnection();
    if (!connecting || !svgEl) return;

    const srcNode = nodes.find(n => n.id === connecting.source);
    if (!srcNode) return;

    const sx = (srcNode.position?.x || 0) + NODE_W;
    const sy = (srcNode.position?.y || 0) + NODE_H / 2;
    const rect = svgEl.getBoundingClientRect();
    const tx = (e.clientX - rect.left - panOffset.x) / zoom;
    const ty = (e.clientY - rect.top - panOffset.y) / zoom;

    const dx = tx - sx;
    const dist = Math.abs(dx);
    const cpDist = Math.max(60, dist * 0.4);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${sx},${sy} C${sx + cpDist},${sy} ${tx - cpDist},${ty} ${tx},${ty}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'var(--accent-cyan)');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-dasharray', '6 3');
    path.setAttribute('id', 'temp-connection');
    path.setAttribute('opacity', '0.6');

    const edgesLayer = document.getElementById('edges-layer');
    if (edgesLayer) edgesLayer.appendChild(path);
  }

  function removeTempConnection() {
    const existing = document.getElementById('temp-connection');
    if (existing) existing.remove();
  }

  // ── Edge Routing ──

  /**
   * Compute a bezier path. Supports per-edge manual control point offsets.
   * Auto-avoidance runs only when no manual offsets are set.
   */
  function computeEdgePath(src, tgt, edge) {
    const sx = (src.position?.x || 0) + NODE_W;
    const sy = (src.position?.y || 0) + NODE_H / 2;
    const tx = tgt.position?.x || 0;
    const ty = (tgt.position?.y || 0) + NODE_H / 2;

    const dx = Math.abs(tx - sx);
    const cpDist = Math.max(40, dx * 0.35);

    // Auto-avoidance nudge (only when no manual bend)
    let autoNudge = 0;
    if (!edge?.bendOffset) {
      const corridorLeft = Math.min(sx, tx);
      const corridorRight = Math.max(sx, tx);

      for (const n of nodes) {
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

    // Midpoint for label
    const t = 0.5;
    const mx = (1-t)*(1-t)*(1-t)*sx + 3*(1-t)*(1-t)*t*cp1x + 3*(1-t)*t*t*cp2x + t*t*t*tx;
    const my = (1-t)*(1-t)*(1-t)*sy + 3*(1-t)*(1-t)*t*cp1y + 3*(1-t)*t*t*cp2y + t*t*t*ty;

    return { d, mx, my };
  }

  // ── Render Edges ──

  function renderEdges() {
    const layer = document.getElementById('edges-layer');
    if (!layer) return;

    layer.innerHTML = edges.map(edge => {
      const src = nodes.find(n => n.id === edge.source);
      const tgt = nodes.find(n => n.id === edge.target);
      if (!src || !tgt) return '';

      const { d, mx, my } = computeEdgePath(src, tgt, edge);

      const edgeStatus = getEdgeStatus(src, tgt);
      const isDragging = draggingEdge && draggingEdge.id === edge.id;
      const strokeColor = edgeStatus === 'running' ? 'var(--accent-cyan)' :
                           edgeStatus === 'completed' ? 'var(--accent-green)' :
                           edgeStatus === 'failed' ? 'var(--accent-red)' :
                           isDragging ? 'var(--accent-amber)' :
                           'var(--accent-cyan-dim)';
      const markerId = edgeStatus ? `arrowhead-${edgeStatus}` : 'arrowhead';
      const dashAttr = edgeStatus === 'running' ? 'stroke-dasharray="8 4"' : '';

      return `
        <g class="wf-edge ${edgeStatus}" data-id="${edge.id}">
          <!-- Wide hit area for drag and click -->
          <path d="${d}" fill="none" stroke="transparent" stroke-width="20"
                class="edge-hit" data-id="${edge.id}"
                style="cursor:${isDragging ? 'grabbing' : 'ns-resize'};" />
          <!-- Visible path -->
          <path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${isDragging ? 2.5 : 2}"
                marker-end="url(#${markerId})" opacity="${isDragging ? 1 : 0.8}" ${dashAttr}/>
          ${edge.label ? `
            <g class="edge-label" transform="translate(${mx},${my - 8})">
              <rect x="-4" y="-11" width="${edge.label.length * 7 + 8}" height="15" rx="3"
                    fill="var(--bg-secondary)" stroke="var(--border-subtle)" stroke-width="0.5" opacity="0.9"
                    transform="translate(-${(edge.label.length * 7 + 8) / 2}, 0)"/>
              <text text-anchor="middle" dy="-1"
                    fill="var(--text-secondary)" font-size="10" font-family="var(--font-mono)">
                ${escapeXml(edge.label)}
              </text>
            </g>
          ` : ''}
        </g>
      `;
    }).join('');

    // Bind edge events
    layer.querySelectorAll('.edge-hit').forEach(el => {
      // Mousedown → start dragging the edge
      el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const edge = edges.find(ed => ed.id === el.dataset.id);
        if (!edge) return;
        const rect = svgEl.getBoundingClientRect();
        draggingEdge = {
          id: edge.id,
          startY: (e.clientY - rect.top - panOffset.y) / zoom,
          startBend: edge.bendOffset || 0
        };
        selectedEdgeId = edge.id;
      });

      // Right-click → context menu with delete
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const edge = edges.find(ed => ed.id === el.dataset.id);
        if (edge) {
          const containerRect = document.getElementById('canvas-container').getBoundingClientRect();
          const x = e.clientX - containerRect.left;
          const y = e.clientY - containerRect.top;
          showDeleteToolbar('edge', el.dataset.id, x, y);
        }
      });

      // Double-click → edit edge label
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const edge = edges.find(ed => ed.id === el.dataset.id);
        if (edge) {
          showEdgeLabelEditor(edge);
        }
      });
    });
  }

  // ── Edge Status ──

  function getEdgeStatus(sourceNode, targetNode) {
    if (sourceNode?.status === 'running' || targetNode?.status === 'running') return 'running';
    if (sourceNode?.status === 'completed' && targetNode?.status === 'completed') return 'completed';
    if (sourceNode?.status === 'failed' || targetNode?.status === 'failed') return 'failed';
    return '';
  }

  // ── Node Detail Panel ──

  function showNodeDetail(nodeId) {
    selectedNodeId = nodeId;
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Re-render to show selection highlight
    renderAll();

    let panel = document.getElementById('wf-detail-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'wf-detail-panel';
      panel.className = 'wf-detail-panel';
      const container = document.getElementById('canvas-container');
      if (container && container.parentElement) {
        container.parentElement.appendChild(panel);
      }
    }

    const status = node.status || 'pending';
    const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;

    panel.innerHTML = `
      <div style="padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 id="detail-node-title" style="font-size:14px;font-weight:600;margin:0;">${escapeXml(node.label)}</h3>
          <button class="btn btn-sm btn-ghost" id="close-detail" style="font-size:16px;line-height:1;">${Icon.svg('close', 16)}</button>
        </div>

        <div class="form-group">
          <div class="form-label">状态</div>
          <span class="badge badge-${status}">${statusCfg.text}</span>
        </div>

        <div class="form-group">
          <div class="form-label">类型</div>
          <span style="font-size:12px;color:var(--text-secondary);">${escapeXml(node.type || 'agent')}</span>
        </div>

        ${node.agentId ? `
          <div class="form-group">
            <div class="form-label">Agent ID</div>
            <div style="font-family:var(--font-mono);font-size:11px;">${escapeXml(node.agentId)}</div>
          </div>
        ` : ''}

        ${(node.type === 'agent' || !node.type || node.type === 'developer' || node.type === 'reviewer' || node.type === 'tester' || node.type === 'planner' || node.type === 'debugger' || node.type === 'documenter') ? `
          <div class="form-group">
            <div class="form-label">关联智能体</div>
            <select id="detail-agent-id" style="width:100%;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;">
              <option value="">-- 选择已有智能体 --</option>
            </select>
          </div>
          <div class="form-group">
            <div class="form-label">默认提示词</div>
            <textarea id="detail-default-prompt" rows="4" placeholder="通用流程描述，每次执行自动使用"
                      style="width:100%;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;font-family:var(--font-mono);resize:vertical;">${escapeXml(node.defaultPrompt || '')}</textarea>
          </div>
          <div class="form-group" style="margin-top:8px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;">
              <input type="checkbox" id="detail-requires-input" ${node.requiresInput ? 'checked' : ''}>
              <span>执行前需要输入本次工作内容</span>
            </label>
          </div>
          <button class="btn btn-sm btn-primary" id="detail-save-agent-prompt" style="margin-top:8px;width:100%;">保存配置</button>
        ` : ''}

        ${node.startedAt ? `
          <div class="form-group">
            <div class="form-label">开始时间</div>
            <div style="font-size:12px;">${new Date(node.startedAt).toLocaleString()}</div>
          </div>
        ` : ''}

        ${node.completedAt ? `
          <div class="form-group">
            <div class="form-label">完成时间</div>
            <div style="font-size:12px;">${new Date(node.completedAt).toLocaleString()}</div>
          </div>
        ` : ''}

        ${node.type === 'subworkflow' ? `
          <div class="form-group">
            <div class="form-label">子工作流</div>
            <select id="detail-cfg-sub-workflow-id" style="width:100%;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;">
              <option value="">请选择工作流...</option>
            </select>
          </div>
          <div class="form-group" style="margin-top:8px;">
            <div class="form-label">输入映射</div>
            <textarea id="detail-cfg-input-mapping" rows="3" placeholder='{"key": "upstreamNodeId"}'
                      style="width:100%;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;font-family:var(--font-mono);resize:vertical;">${escapeXml(node.config?.inputMapping || '')}</textarea>
          </div>
          <button class="btn btn-sm btn-primary" id="detail-save-subworkflow" style="margin-top:8px;width:100%;">保存子工作流配置</button>
        ` : ''}


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

    document.getElementById('close-detail')?.addEventListener('click', hideNodeDetail);

    // Load subworkflow options if this is a subworkflow node
    if (node.type === 'subworkflow') {
      setTimeout(() => loadSubWorkflowOptions('detail-cfg-sub-workflow-id', node.config?.subWorkflowId || ''), 0);
    }

    // Bind config save buttons
    bindDetailConfigSave(node);
  }

  function bindDetailConfigSave(node) {
    // Subworkflow config save
    document.getElementById('detail-save-subworkflow')?.addEventListener('click', () => {
      if (!node.config) node.config = {};
      const swSelect = document.getElementById('detail-cfg-sub-workflow-id');
      node.config.subWorkflowId = swSelect?.value || '';
      node.config.inputMapping = document.getElementById('detail-cfg-input-mapping')?.value || '';
      // Auto-update node label to selected workflow name
      if (swSelect && swSelect.value) {
        const selectedOpt = swSelect.options[swSelect.selectedIndex];
        if (selectedOpt && selectedOpt.textContent) {
          const wfName = selectedOpt.textContent.replace(/\s*\(\d+ 节点\)\s*$/, '').trim();
          if (wfName) {
            node.label = wfName;
            renderAll();
          }
        }
      }
      Toast.show('子工作流配置已更新（请点击保存按钮持久化）', 'info');
    });

    // Agent prompt config save
    document.getElementById('detail-save-agent-prompt')?.addEventListener('click', () => {
      node.agentId = document.getElementById('detail-agent-id')?.value || '';
      node.defaultPrompt = document.getElementById('detail-default-prompt')?.value || '';
      node.requiresInput = document.getElementById('detail-requires-input')?.checked || false;
      // 更新节点标签为所选智能体名称
      const sel = document.getElementById('detail-agent-id');
      if (sel && sel.selectedIndex > 0) {
        const selectedName = sel.options[sel.selectedIndex].textContent;
        if (selectedName) {
          node.label = selectedName;
          const titleEl = document.getElementById('detail-node-title');
          if (titleEl) titleEl.textContent = selectedName;
        }
      }
      renderAll();
      Toast.show('配置已更新（请点击保存按钮持久化）', 'info');
    });

    // Load agent options into detail panel dropdown
    if (document.getElementById('detail-agent-id')) {
      loadAgentOptionsForDetail(node.agentId || '');
    }
  }

  function hideNodeDetail() {
    selectedNodeId = null;
    document.getElementById('wf-detail-panel')?.remove();
    renderAll();
  }

  // ── Add Node ──

  function addNode(agentData) {
    if (agentData) {
      // Importing an agent: create node directly
      const id = 'n' + (nextNodeId++);
      nodes.push({
        id,
        label: agentData.name,
        type: agentData.role || 'agent',
        agentId: agentData.id,
        position: { x: 100 + nodes.length * 40, y: 100 + (nodes.length % 3) * 100 },
        config: { systemPrompt: agentData.config?.systemPrompt || '' },
      });
      _onEdit?.();
      renderAll();
      return;
    }

    // No agent data: show node type selection modal
    showAddNodeModal();
  }

  function showAddNodeModal() {
    const typeCardsHtml = NODE_TYPES.map(nt => `
      <div class="card hover-lift node-type-card" data-type="${nt.type}"
           style="padding:12px;cursor:pointer;display:flex;align-items:center;gap:12px;margin-bottom:8px;">
        <div style="width:36px;height:36px;border-radius:50%;background:${nt.color};opacity:0.15;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <span style="display:flex;align-items:center;justify-content:center;width:20px;height:20px;color:${nt.color};">${nt.icon}</span>
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;">${nt.label}</div>
          <div style="font-size:11px;color:var(--text-muted);">${nt.type}</div>
        </div>
      </div>
    `).join('');

    Modal.open({
      title: '添加节点',
      body: `
        <div style="max-height:400px;overflow-y:auto;">
          <div style="margin-bottom:12px;">
            <div class="form-label" style="margin-bottom:8px;">选择节点类型</div>
            ${typeCardsHtml}
          </div>
          <div id="node-config-fields"></div>
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="add-node-confirm" disabled>添加</button>
      `,
    });

    let selectedType = null;

    // Type card click
    document.querySelectorAll('.node-type-card').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.node-type-card').forEach(c => {
          c.style.borderColor = 'var(--border-subtle)';
          c.style.borderWidth = '1px';
        });
        el.style.borderColor = 'var(--accent-cyan)';
        el.style.borderWidth = '2px';
        selectedType = el.dataset.type;
        document.getElementById('add-node-confirm').disabled = false;
        showNodeConfigFields(selectedType);
      });
    });

    // Confirm
    document.getElementById('add-node-confirm').addEventListener('click', () => {
      if (!selectedType) return;
      createNodeWithType(selectedType);
      Modal.close();
    });
  }

  function showNodeConfigFields(type) {
    const container = document.getElementById('node-config-fields');
    if (!container) return;

    const nt = NODE_TYPES.find(n => n.type === type);
    const defaultLabel = nt ? nt.label : type;

    let fieldsHtml = `
      <div class="form-group">
        <div class="form-label">节点名称</div>
        <input type="text" id="node-cfg-label" class="form-input" value="${defaultLabel}" placeholder="输入节点名称" style="width:100%;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;">
      </div>
    `;

    switch (type) {
      

      


      case 'parallel':
        fieldsHtml += `
          <div class="form-group" style="margin-top:8px;">
            <div class="form-label">并行分支数</div>
            <input type="number" id="node-cfg-branches" class="form-input" value="2" min="2" max="10" style="width:100%;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;">
          </div>
        `;
        break;


      case 'subworkflow':
        fieldsHtml += `
          <div style="padding:16px;text-align:center;color:var(--text-muted);">
            <p>选择工作流后将自动展开其所有节点</p>
            <button class="btn btn-primary" id="pick-wf-btn" style="margin-top:8px;">选择工作流</button>
          </div>
        `;
        setTimeout(() => {
          document.getElementById('pick-wf-btn')?.addEventListener('click', () => pickWorkflowAndInline());
        }, 0);
        break;

      case 'approval':
        fieldsHtml += `
          <div class="form-group" style="margin-top:8px;">
            <div class="form-label">审核标题</div>
            <input type="text" id="node-cfg-approval-title" class="form-input" value="" placeholder="审核主题" style="width:100%;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;">
          </div>
          <div class="form-group" style="margin-top:8px;">
            <div class="form-label">审核描述</div>
            <textarea id="node-cfg-approval-desc" rows="3" placeholder="描述需要审核的内容..." style="width:100%;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;resize:vertical;"></textarea>
          </div>
          <div class="form-group" style="margin-top:8px;">
            <div class="form-label">超时时间（秒）</div>
            <input type="number" id="node-cfg-approval-timeout" class="form-input" value="3600" min="60" step="60" style="width:100%;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;">
          </div>
        `;
        break;


      default:
        // agent type: agent selector + defaultPrompt + requiresInput
        fieldsHtml += `
          <div class="form-group" style="margin-top:8px;">
            <div class="form-label">选择智能体</div>
            <select id="node-cfg-agent-id" style="width:100%;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;">
              <option value="">-- 选择已有智能体 --</option>
            </select>
          </div>
          <div class="form-group" style="margin-top:8px;">
            <div class="form-label">默认提示词</div>
            <textarea id="node-cfg-default-prompt" rows="4" placeholder="通用流程描述，每次执行自动使用"
                      style="width:100%;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;font-family:var(--font-mono);resize:vertical;"></textarea>
          </div>
          <div class="form-group" style="margin-top:8px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;">
              <input type="checkbox" id="node-cfg-requires-input">
              <span>执行前需要输入本次工作内容</span>
            </label>
          </div>
        `;
        // Load agent options asynchronously
        setTimeout(() => loadAgentOptions(), 0);
        break;
    }

    container.innerHTML = fieldsHtml;
  }

  function createNodeWithType(type) {
    const id = 'n' + (nextNodeId++);
    const labelEl = document.getElementById('node-cfg-label');
    const label = labelEl ? labelEl.value.trim() || type : type;
    const nt = NODE_TYPES.find(n => n.type === type);

    const config = {};

    switch (type) {
      case 'approval':
        config.approvalTitle = document.getElementById('node-cfg-approval-title')?.value || '';
        config.approvalDescription = document.getElementById('node-cfg-approval-desc')?.value || '';
        config.timeout = parseInt(document.getElementById('node-cfg-approval-timeout')?.value, 10) || 3600;
        break;

      case 'parallel':
        config.branches = parseInt(document.getElementById('node-cfg-branches')?.value, 10) || 2;
        break;

      case 'subworkflow': {
        // Selection handled by pickWorkflowAndInline() — placeholder node removed on success
        return;
      }

    }

    const nodeData = {
      id,
      label,
      type,
      agentId: document.getElementById('node-cfg-agent-id')?.value || '',
      position: { x: 100 + nodes.length * 40, y: 100 + (nodes.length % 3) * 100 },
      config,
    };

    // Agent-specific fields
    if (type === 'agent' || type === 'developer' || type === 'reviewer' || type === 'tester' ||
        type === 'planner' || type === 'debugger' || type === 'documenter') {
      nodeData.defaultPrompt = document.getElementById('node-cfg-default-prompt')?.value || '';
      nodeData.requiresInput = document.getElementById('node-cfg-requires-input')?.checked || false;
    }

    nodes.push(nodeData);
    _onEdit?.();
    renderAll();
  }

  // ── Update Node Status (single node, no full re-render) ──

  function updateNodeStatus(nodeId, status, output) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    node.status = status;
    if (output !== undefined) node.output = output;
    if (status === 'running') node.startedAt = new Date().toISOString();
    if (status === 'completed' || status === 'failed') node.completedAt = new Date().toISOString();
    renderAll();
    // If detail panel is open for this node, refresh it
    if (selectedNodeId === nodeId) {
      showNodeDetail(nodeId);
    }
  }

  // ── Set Execution Data (batch from /execution API) ──

  function setExecutionData(executionData) {
    if (!executionData?.nodes) return;
    for (const nodeData of executionData.nodes) {
      const node = nodes.find(n => n.id === nodeData.nodeId);
      if (node) {
        node.status = nodeData.status;
        node.output = nodeData.output;
        node.startedAt = nodeData.startedAt;
        node.completedAt = nodeData.completedAt;
        node.logs = nodeData.logs || [];
      }
    }
    renderAll();
    // Refresh detail panel if open
    if (selectedNodeId) {
      const node = nodes.find(n => n.id === selectedNodeId);
      if (node) showNodeDetail(selectedNodeId);
    }
  }

  // ── Load Workflow ──

  function loadWorkflow(workflow) {
    nodes = workflow ? [...(workflow.nodes || [])] : [];
    edges = workflow ? [...(workflow.edges || [])] : [];
    nextNodeId = nodes.length + 1;
    panOffset = { x: 0, y: 0 };
    zoom = 1;
    selectedNodeId = null;
    hideNodeDetail();
    renderAll();
    updateTransform();
  }

  // ── Zoom Controls ──

  function zoomIn() {
    zoom = Math.min(3, zoom * 1.2);
    updateTransform();
  }

  function zoomOut() {
    zoom = Math.max(0.3, zoom / 1.2);
    updateTransform();
  }

  function zoomReset() {
    zoom = 1;
    panOffset = { x: 0, y: 0 };
    updateTransform();
  }

  // ── Delete Toolbar ──

  function showDeleteToolbar(targetType, targetId, x, y) {
    hideDeleteToolbar();
    const toolbar = document.createElement('div');
    toolbar.id = 'wf-delete-toolbar';
    toolbar.style.cssText = `
      position:absolute; z-index:100; display:flex; gap:4px;
      background:var(--bg-secondary); border:1px solid var(--border-subtle);
      border-radius:var(--border-radius-md); padding:4px 8px;
      box-shadow:0 4px 12px rgba(0,0,0,0.3);
      left:${x}px; top:${y - 40}px;
    `;
    toolbar.innerHTML = `
      <button class="btn btn-sm btn-danger" id="wf-delete-target" style="font-size:11px;padding:2px 10px;">
        删除${targetType === 'node' ? '节点' : '连线'}
      </button>
      <button class="btn btn-sm btn-ghost" id="wf-cancel-delete" style="font-size:11px;padding:2px 6px;">${Icon.svg('close', 14)}</button>
    `;
    const container = document.getElementById('canvas-container');
    if (container) container.appendChild(toolbar);

    document.getElementById('wf-delete-target').addEventListener('click', () => {
      if (targetType === 'node') {
        nodes = nodes.filter(n => n.id !== targetId);
        edges = edges.filter(ed => ed.source !== targetId && ed.target !== targetId);
        if (selectedNodeId === targetId) hideNodeDetail();
      } else {
        edges = edges.filter(e => e.id !== targetId);
      }
      hideDeleteToolbar();
      renderAll();
    });

    document.getElementById('wf-cancel-delete').addEventListener('click', hideDeleteToolbar);
  }

  function hideDeleteToolbar() {
    document.getElementById('wf-delete-toolbar')?.remove();
  }

  // ── Edge Label Editor ──

  function showEdgeLabelEditor(edge) {
    const currentLabel = edge.label || '';

    Modal.open({
      title: '编辑连线标签',
      body: `
        <div class="form-group">
          <div class="form-label">标签文本</div>
          <input type="text" id="edge-label-input" class="form-input" value="${escapeXml(currentLabel)}"
                 placeholder="输入连线标签，留空则不显示"
                 style="width:100%;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;">
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="edge-label-confirm">确定</button>
      `,
    });

    document.getElementById('edge-label-confirm').addEventListener('click', () => {
      const newLabel = document.getElementById('edge-label-input')?.value.trim();
      if (newLabel) {
        edge.label = newLabel;
      } else {
        delete edge.label;
      }
      Modal.close();
      renderEdges();
    });
  }

  // ── Node Context Menu ──

  function showNodeContextMenu(nodeId, mouseX, mouseY) {
    hideContextMenu();
    const menu = document.createElement('div');
    menu.id = 'wf-context-menu';
    menu.style.cssText = `
      position:fixed; z-index:200; min-width:160px;
      background:var(--bg-secondary); border:1px solid var(--border-subtle);
      border-radius:var(--border-radius-md); padding:4px 0;
      box-shadow:0 8px 24px rgba(0,0,0,0.4);
      left:${mouseX}px; top:${mouseY}px;
    `;

    const hasBp = breakpoints.has(nodeId);

    menu.innerHTML = `
      <div class="ctx-item" data-action="test" style="padding:8px 16px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:8px;">
        <span style="color:var(--accent-cyan);">${Icon.svg('play', 14)}</span> 测试此节点
      </div>
      <div class="ctx-item" data-action="breakpoint" style="padding:8px 16px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:8px;">
        <span style="color:${hasBp ? 'var(--accent-green)' : 'var(--accent-red)'};">${hasBp ? '●' : '○'}</span> ${hasBp ? '取消断点' : '设置断点'}
      </div>
      <div style="height:1px;background:var(--border-subtle);margin:4px 0;"></div>
      <div class="ctx-item" data-action="delete" style="padding:8px 16px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:8px;color:var(--accent-red);">
        <span>${Icon.svg('delete', 14)}</span> 删除节点
      </div>
    `;

    document.body.appendChild(menu);

    // Adjust position if menu goes off screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.ctx-item');
      if (!item) return;
      const action = item.dataset.action;

      if (action === 'test') {
        showTestNodeDialog(nodeId);
      } else if (action === 'breakpoint') {
        toggleBreakpoint(nodeId);
      } else if (action === 'delete') {
        nodes = nodes.filter(n => n.id !== nodeId);
        edges = edges.filter(ed => ed.source !== nodeId && ed.target !== nodeId);
        if (selectedNodeId === nodeId) hideNodeDetail();
        if (connecting && connecting.source === nodeId) connecting = null;
        renderAll();
      }
      hideContextMenu();
    });

    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', hideContextMenu, { once: true });
    }, 0);
  }

  function hideContextMenu() {
    document.getElementById('wf-context-menu')?.remove();
  }

  function toggleBreakpoint(nodeId) {
    if (breakpoints.has(nodeId)) {
      breakpoints.delete(nodeId);
      Toast.success('已取消断点');
    } else {
      breakpoints.add(nodeId);
      Toast.success('已设置断点');
    }
    renderAll();
  }

  function showTestNodeDialog(nodeId) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    Modal.open({
      title: `测试节点: ${escapeXml(node.label)}`,
      body: `
        <div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">
            节点类型: ${escapeXml(node.type || 'agent')}
          </div>
          <div class="form-group">
            <div class="form-label">测试输入</div>
            <textarea id="test-node-input" rows="5" placeholder="输入测试数据（JSON格式），可留空"
                      style="width:100%;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;font-family:var(--font-mono);resize:vertical;"></textarea>
          </div>
          <div id="test-node-result" style="margin-top:12px;"></div>
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">关闭</button>
        <button class="btn btn-primary" id="test-node-confirm">执行测试</button>
      `,
    });

    document.getElementById('test-node-confirm')?.addEventListener('click', async () => {
      const inputText = document.getElementById('test-node-input')?.value.trim();
      let testInput = {};
      if (inputText) {
        try {
          testInput = JSON.parse(inputText);
        } catch (e) {
          Toast.error('参数格式错误，请输入有效的 JSON');
          return;
        }
      }

      const resultEl = document.getElementById('test-node-result');
      if (resultEl) resultEl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">正在执行测试...</div>';

      try {
        // Get workflow id from parent page
        const wfId = window.WorkflowsPage?.getCurrentWorkflowId?.();
        if (!wfId) {
          if (resultEl) resultEl.innerHTML = '<div style="color:var(--accent-red);font-size:12px;">无法获取工作流 ID</div>';
          return;
        }
        const res = await API.testNode(wfId, nodeId, testInput);
        if (resultEl) {
          resultEl.innerHTML = `
            <div class="form-label">测试结果</div>
            <div style="background:var(--bg-deep);padding:8px;border-radius:4px;font-size:12px;font-family:var(--font-mono);word-break:break-word;max-height:200px;overflow-y:auto;">
              ${escapeXml(JSON.stringify(res.data, null, 2) || '无输出')}
            </div>
          `;
        }
      } catch (e) {
        if (resultEl) resultEl.innerHTML = `<div style="color:var(--accent-red);font-size:12px;">测试失败: ${escapeXml(e.message)}</div>`;
      }
    });
  }

  // ── Error Detail Panel (for failed nodes) ──

  function showErrorDetailPanel(nodeId) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node || node.status !== 'failed') return;

    let panel = document.getElementById('wf-error-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'wf-error-panel';
      panel.style.cssText = `
        position:absolute; z-index:150; top:50%; left:50%; transform:translate(-50%,-50%);
        width:480px; max-height:400px; overflow-y:auto;
        background:var(--bg-secondary); border:1px solid var(--accent-red);
        border-radius:var(--border-radius-lg); box-shadow:0 8px 32px rgba(0,0,0,0.5);
      `;
      const container = document.getElementById('canvas-container');
      if (container) container.appendChild(panel);
    }

    const errorMsg = node.error || node.output || '未知错误';
    const errorLogs = (node.logs || []).filter(l => l.level === 'error');

    panel.innerHTML = `
      <div style="padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="font-size:14px;font-weight:600;margin:0;color:var(--accent-red);">
            错误详情: ${escapeXml(node.label)}
          </h3>
          <button class="btn btn-sm btn-ghost" id="close-error-panel" style="font-size:16px;line-height:1;">${Icon.svg('close', 16)}</button>
        </div>
        <div style="background:var(--bg-deep);padding:10px;border-radius:4px;border-left:3px solid var(--accent-red);margin-bottom:12px;">
          <div style="font-size:12px;font-family:var(--font-mono);word-break:break-word;color:var(--text-primary);">
            ${escapeXml(errorMsg)}
          </div>
        </div>
        ${errorLogs.length > 0 ? `
          <div class="form-label" style="margin-bottom:8px;">错误日志 (${errorLogs.length})</div>
          <div class="log-viewer" style="max-height:150px;">
            ${errorLogs.map(log => `
              <div class="log-entry">
                <span class="log-timestamp">${new Date(log.timestamp).toLocaleTimeString()}</span>
                <span class="log-level error">error</span>
                <span class="log-message">${escapeXml(log.message)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${node.completedAt ? `
          <div style="font-size:11px;color:var(--text-muted);margin-top:8px;">
            失败时间: ${new Date(node.completedAt).toLocaleString()}
          </div>
        ` : ''}
      </div>
    `;

    document.getElementById('close-error-panel')?.addEventListener('click', () => {
      document.getElementById('wf-error-panel')?.remove();
    });
  }

  // ── Subworkflow Dropdown Loader ──

  async function pickWorkflowAndInline() {
    try {
      const res = await API.getWorkflows({ page: 1, limit: 100 });
      const allWfs = Array.isArray(res.data) ? res.data : (res.data?.items || []);
      // Filter out self
      const wfs = allWfs.filter(w => w.id !== (_currentWorkflow?.id || ''));
      if (wfs.length === 0) {
        Toast.warning('没有可用的工作流');
        return;
      }

      Modal.open({
        title: '选择要内联的工作流',
        body: `
          <div style="max-height:400px;overflow-y:auto;">
            ${wfs.map(w => `
              <div class="wf-pick-item" data-wf-id="${w.id}" style="padding:12px;border:1px solid var(--border-subtle);border-radius:4px;margin-bottom:6px;cursor:pointer;"
                   onmouseenter="this.style.background='var(--bg-deep)'" onmouseleave="this.style.background='transparent'">
                <div style="font-size:13px;font-weight:600;">${w.name || w.id}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${w.description || ''} · ${(w.nodes || []).length} 节点</div>
              </div>
            `).join('')}
          </div>
        `,
        footer: `<button class="btn btn-secondary" onclick="Modal.close()">取消</button>`,
      });

      setTimeout(() => {
        document.querySelectorAll('.wf-pick-item').forEach(item => {
          item.addEventListener('click', async () => {
            const wfId = item.dataset.wfId;
            Modal.close();
            await inlineWorkflow(wfId);
          });
        });
      }, 100);
    } catch (e) {
      Toast.error('获取工作流列表失败');
    }
  }

  async function inlineWorkflow(wfId) {
    try {
      const res = await API.getWorkflow(wfId);
      const wf = res.data;
      if (!wf || !wf.nodes || wf.nodes.length === 0) {
        Toast.warning('所选工作流无节点');
        return;
      }

      // Calculate position offset: below all existing nodes
      const maxY = nodes.reduce((max, n) => Math.max(max, n.position?.y || 0), 0);
      const offsetY = maxY + 120;

      // Build ID map: old IDs → new IDs
      const idMap = {};
      const newNodes = [];
      for (const node of wf.nodes) {
        if (node.type === 'start' || node.type === 'end') continue;
        const newId = 'n' + (nextNodeId++);
        idMap[node.id] = newId;
        newNodes.push({
          ...node,
          id: newId,
          position: { x: (node.position?.x || 100), y: (node.position?.y || 100) + offsetY },
        });
      }

      // Build new edges with mapped IDs
      const newEdges = [];
      for (const edge of (wf.edges || [])) {
        const src = idMap[edge.source] || edge.source;
        const tgt = idMap[edge.target] || edge.target;
        // Skip edges connected to start/end nodes (not copied)
        const srcNode = wf.nodes.find(n => n.id === edge.source);
        const tgtNode = wf.nodes.find(n => n.id === edge.target);
        if (!srcNode || srcNode.type === 'start' || !tgtNode || tgtNode.type === 'end') continue;
        newEdges.push({
          id: 'e' + (edges.length + newEdges.length + 1),
          source: src,
          target: tgt,
          label: edge.label || ''
        });
      }

      // Add to canvas
      nodes.push(...newNodes);
      edges.push(...newEdges);
      Toast.success(`已内联工作流 "${wf.name}" (${newNodes.length} 节点)`);
      Modal.close();
      _onEdit?.();
      renderAll();
    } catch (e) {
      Toast.error('内联工作流失败: ' + (e.message || '未知错误'));
    }
  }

  async function loadSubWorkflowOptions(selectId, currentValue) {
    try {
      const res = await API.getWorkflowsForSelection();
      const select = document.getElementById(selectId);
      if (!select || !res.data) return;
      for (const wf of res.data) {
        const opt = document.createElement('option');
        opt.value = wf.id;
        opt.textContent = `${wf.name} (${wf.nodeCount} 节点)`;
        if (wf.id === currentValue) opt.selected = true;
        select.appendChild(opt);
      }
    } catch (e) {
      // ignore - select will just show no options
    }
  }

  // ── Agent Dropdown Loader ──

  async function loadAgentOptions(currentValue) {
    try {
      const res = await API.getAgents();
      const select = document.getElementById('node-cfg-agent-id');
      if (!select || !res.data) return;
      const agents = Array.isArray(res.data) ? res.data : (res.data?.items || []);
      for (const ag of agents) {
        const opt = document.createElement('option');
        opt.value = ag.id;
        opt.textContent = ag.name || ag.id;
        if (ag.id === currentValue) opt.selected = true;
        select.appendChild(opt);
      }
      // Auto-fill fields when agent is selected
      select.addEventListener('change', () => {
        const agentId = select.value;
        if (!agentId) return;
        const agent = agents.find(a => a.id === agentId);
        if (!agent) return;
        // Auto-fill node name
        const labelEl = document.getElementById('node-cfg-label');
        if (labelEl && !labelEl.dataset.userEdited) {
          labelEl.value = agent.name || '';
        }
        // Auto-fill default prompt
        const promptEl = document.getElementById('node-cfg-default-prompt');
        if (promptEl && !promptEl.dataset.userEdited && agent.config?.systemPrompt) {
          promptEl.value = agent.config.systemPrompt;
        }
      });
      // Mark label & prompt as user-edited when manually changed
      ['node-cfg-label', 'node-cfg-default-prompt'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('input', () => { el.dataset.userEdited = '1'; });
        }
      });
    } catch (e) {
      // ignore - select will just show no options
    }
  }

  async function loadAgentOptionsForDetail(currentValue) {
    try {
      const res = await API.getAgents();
      const select = document.getElementById('detail-agent-id');
      if (!select || !res.data) return;
      const agents = Array.isArray(res.data) ? res.data : (res.data?.items || []);
      for (const ag of agents) {
        const opt = document.createElement('option');
        opt.value = ag.id;
        opt.textContent = ag.name || ag.id;
        if (ag.id === currentValue) opt.selected = true;
        select.appendChild(opt);
      }
      // 选择智能体时自动更新节点标题
      const titleEl = document.getElementById('detail-node-title');
      const labelEl = titleEl; // 细节面板没有单独的 label 输入框，直接更新标题
      select.addEventListener('change', () => {
        if (select.selectedIndex > 0) {
          const name = select.options[select.selectedIndex].textContent;
          if (name && titleEl) {
            titleEl.textContent = name;
          }
        }
      });
    } catch (e) {
      // ignore
    }
  }

  // ── Snapshot Functions ──

  async function saveSnapshot() {
    if (!_currentWorkflow) return;
    const name = await Modal.prompt('保存快照', '请输入快照名称:', `快照 ${new Date().toLocaleString('zh-CN')}`);
    if (!name) return;
    try {
      await API.saveSnapshot(_currentWorkflow.id, name);
      Toast.success('快照已保存');
    } catch (e) {
      Toast.error('保存失败: ' + e.message);
    }
  }

  async function showSnapshotList() {
    if (!_currentWorkflow) return;
    try {
      const res = await API.getSnapshots(_currentWorkflow.id);
      const snapshots = res.data || [];

      if (snapshots.length === 0) {
        Toast.info('暂无快照');
        return;
      }

      Modal.open({
        title: '快照列表',
        body: `
          <div style="max-height:400px;overflow-y:auto;">
            ${snapshots.map(s => `
              <div class="card" style="padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-weight:600;">${escapeXml(s.name)}</div>
                  <div style="font-size:11px;color:var(--text-tertiary);">${new Date(s.createdAt).toLocaleString('zh-CN')}</div>
                </div>
                <div style="display:flex;gap:6px;">
                  <button class="btn btn-sm btn-primary snapshot-restore" data-id="${s.id}">恢复</button>
                  <button class="btn btn-sm btn-danger snapshot-delete" data-id="${s.id}">删除</button>
                </div>
              </div>
            `).join('')}
          </div>
        `,
        footer: '<button class="btn btn-secondary" onclick="Modal.close()">关闭</button>'
      });

      document.querySelectorAll('.snapshot-restore').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('确定恢复此快照？当前工作流将被覆盖。')) return;
          try {
            await API.restoreSnapshot(_currentWorkflow.id, btn.dataset.id);
            Toast.success('快照已恢复');
            Modal.close();
            location.reload();
          } catch (e) {
            Toast.error('恢复失败: ' + e.message);
          }
        });
      });

      document.querySelectorAll('.snapshot-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('确定删除此快照？')) return;
          try {
            await API.deleteSnapshot(_currentWorkflow.id, btn.dataset.id);
            Toast.success('已删除');
            btn.closest('.card').remove();
          } catch (e) {
            Toast.error('删除失败: ' + e.message);
          }
        });
      });
    } catch (e) {
      Toast.error('获取快照失败: ' + e.message);
    }
  }

  // ── Focus Mode ──

  function toggleFocusMode() {
    _focusMode = !_focusMode;
    const btn = document.getElementById('canvas-focus-btn');

    if (_focusMode) {
      document.querySelector('.sidebar')?.style.setProperty('display', 'none');
      document.querySelector('.navbar')?.style.setProperty('display', 'none');
      document.getElementById('content')?.style.setProperty('margin-left', '0');
      document.getElementById('content')?.style.setProperty('padding', '0');
      btn?.classList.add('btn-primary');
      btn?.classList.remove('btn-secondary');
      btn.textContent = '退出专注';
    } else {
      document.querySelector('.sidebar')?.style.removeProperty('display');
      document.querySelector('.navbar')?.style.removeProperty('display');
      document.getElementById('content')?.style.removeProperty('margin-left');
      document.getElementById('content')?.style.removeProperty('padding');
      btn?.classList.remove('btn-primary');
      btn?.classList.add('btn-secondary');
      btn.textContent = '专注';
    }
  }

  // ── Drag File to Workflow ──

  function findNearestNode(x, y) {
    if (!_currentWorkflow) return null;
    const wfNodes = _currentWorkflow.nodes || [];
    let nearest = null;
    let minDist = 100;

    for (const node of wfNodes) {
      const nx = node.position?.x || 0;
      const ny = node.position?.y || 0;
      const dist = Math.sqrt((x - nx) ** 2 + (y - ny) ** 2);
      if (dist < minDist) {
        minDist = dist;
        nearest = node;
      }
    }

    return nearest;
  }

  function initDragDrop() {
    const canvasEl = document.getElementById('canvas-container');
    if (!canvasEl) return;

    canvasEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      canvasEl.style.outline = '2px dashed var(--accent-cyan)';
    });

    canvasEl.addEventListener('dragleave', () => {
      canvasEl.style.outline = 'none';
    });

    canvasEl.addEventListener('drop', (e) => {
      e.preventDefault();
      canvasEl.style.outline = 'none';

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      const rect = canvasEl.getBoundingClientRect();
      const x = (e.clientX - rect.left - panOffset.x) / zoom;
      const y = (e.clientY - rect.top - panOffset.y) / zoom;

      const nearestNode = findNearestNode(x, y);

      if (nearestNode) {
        const filePaths = files.map(f => f.name).join(', ');
        nearestNode.defaultPrompt = (nearestNode.defaultPrompt || '') + `\n\n处理文件: ${filePaths}`;
        Toast.success(`已将 ${files.length} 个文件关联到节点 ${nearestNode.label}`);
        renderAll();
      } else {
        Toast.warning('请将文件拖拽到节点上');
      }
    });
  }

  // ── Cleanup ──

  function cleanup() {
    window.removeEventListener('keydown', handleKeyDown);
    if (_onWindowMouseMove) {
      window.removeEventListener('mousemove', _onWindowMouseMove);
      _onWindowMouseMove = null;
    }
    if (_onWindowMouseUp) {
      window.removeEventListener('mouseup', _onWindowMouseUp);
      _onWindowMouseUp = null;
    }
    _wsUnsubs.forEach(fn => fn());
    _wsUnsubs = [];
    _currentWorkflow = null;
    _currentWorkflowId = null;
    _focusMode = false;
    hideNodeDetail();
    hideDeleteToolbar();
    hideContextMenu();
    removeLiveOutputOverlays();
    document.getElementById('wf-error-panel')?.remove();
    if (dragAnimFrame) {
      cancelAnimationFrame(dragAnimFrame);
      dragAnimFrame = null;
    }
  }

  // ── Getters ──

  function getNodes() { return [...nodes]; }
  function getEdges() { return [...edges]; }

  // ── Helpers ──

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '...' : str;
  }

  function escapeXml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    render, init, addNode, getNodes, getEdges,
    updateNodeStatus, setExecutionData, showNodeDetail,
    loadWorkflow, zoomIn, zoomOut, zoomReset, cleanup,
    showErrorDetailPanel,
    setOnEdit(fn) { _onEdit = fn; }
  };
})();
