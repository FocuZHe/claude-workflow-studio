// ═══════════════════════════════════════════════
// WorkflowToolbar Component
// ═══════════════════════════════════════════════

window.WorkflowToolbar = (() => {
  let callbacks = {};

  function render(workflow, executionData) {
    if (!workflow) return '<div class="toolbar" style="opacity:0.5;"><span style="font-size:12px;color:var(--text-muted);">请选择一个工作流开始编辑</span></div>';

    const execStatus = workflow.executionStatus || workflow.status || 'draft';
    const isRunning = execStatus === 'running' || execStatus === 'paused';
    const isCompleted = execStatus === 'completed';
    const isFailed = execStatus === 'failed';
    const progress = executionData?.progress || 0;

    const statusText = isRunning ? (execStatus === 'paused' ? '已暂停' : '运行中') :
                       isCompleted ? '已完成' :
                       isFailed ? '已失败' : '空闲';
    const statusBadgeClass = isRunning ? 'badge-running' :
                             isCompleted ? 'badge-completed' :
                             isFailed ? 'badge-failed' : 'badge-idle';

    return `
      <div class="toolbar">
        <div class="toolbar-group">
          <button class="btn btn-sm btn-secondary" id="wf-add-node" title="添加节点">+ 节点</button>
          <button class="btn btn-sm btn-secondary" id="wf-auto-layout" title="自动排列节点">自动布局</button>
        </div>
        <div class="toolbar-separator"></div>
        <div class="toolbar-group">
          <button class="btn btn-sm btn-primary" id="wf-save" title="保存工作流">保存</button>
          ${isRunning ? `
            <button class="btn btn-sm btn-secondary" id="wf-pause" title="${execStatus === 'paused' ? '恢复执行' : '暂停执行'}">
              ${execStatus === 'paused' ? '恢复' : '暂停'}
            </button>
            <button class="btn btn-sm btn-danger" id="wf-stop" title="停止执行">停止</button>
          ` : `
            <button class="btn btn-sm btn-success" id="wf-run" title="运行工作流">运行</button>
          `}
        </div>
        <div class="toolbar-separator"></div>
        <div class="toolbar-group">
          <button class="btn btn-sm btn-ghost" id="wf-step" title="单步执行（每次只执行一个节点）">单步</button>
          <button class="btn btn-sm btn-ghost" id="wf-simulate" title="模拟运行（使用 mock 数据）">模拟运行</button>
        </div>

        ${isRunning ? `
          <div class="toolbar-separator"></div>
          <div class="toolbar-group" style="flex:1;">
            <span class="badge ${statusBadgeClass}"><span class="dot"></span> ${statusText}</span>
            <div class="wf-progress-bar">
              <div class="wf-progress-fill" style="width:${progress}%"></div>
            </div>
            <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">${progress}%</span>
          </div>
        ` : `
          <div style="flex:1;"></div>
          <span class="badge ${statusBadgeClass}" style="font-size:10px;">${statusText}</span>
        `}

        <div class="toolbar-separator"></div>
        <div class="toolbar-group">
          <button class="btn btn-sm btn-ghost btn-icon" id="wf-zoom-in" title="放大">+</button>
          <button class="btn btn-sm btn-ghost btn-icon" id="wf-zoom-out" title="缩小">-</button>
          <button class="btn btn-sm btn-ghost" id="wf-zoom-reset" title="重置缩放">1:1</button>
        </div>

        <div class="toolbar-separator"></div>
        <div class="toolbar-group">
          <button class="btn btn-sm btn-secondary" id="wf-import-md-btn" title="导入 .md 工作流">📥 导入 .md</button>
          <button class="btn btn-sm btn-secondary" id="wf-export-md-btn" title="导出为 .md 文件">📤 导出 .md</button>
        </div>

        <div class="toolbar-separator"></div>
        <div class="toolbar-group">
          <button class="btn btn-sm btn-secondary" id="wf-memory-settings" title="记忆传递设置">记忆</button>
          <button class="btn btn-sm btn-secondary" id="wf-knowledge-settings" title="知识库注入设置">知识</button>
          <button class="btn btn-sm btn-secondary" id="canvas-snapshot-btn" title="保存快照">快照</button>
          <button class="btn btn-sm btn-secondary" id="canvas-snapshot-list-btn" title="查看快照">快照列表</button>
          <button class="btn btn-sm btn-secondary" id="canvas-focus-btn" title="专注模式">专注</button>
        </div>

        <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">
          ${escapeHtml(workflow.name)}
        </span>
      </div>
    `;
  }

  function init(workflow, executionData, cbs) {
    callbacks = cbs || {};
    document.getElementById('wf-add-node')?.addEventListener('click', () => callbacks.onAddNode?.());
    document.getElementById('wf-save')?.addEventListener('click', () => callbacks.onSave?.());
    document.getElementById('wf-run')?.addEventListener('click', () => callbacks.onRun?.());
    document.getElementById('wf-pause')?.addEventListener('click', () => callbacks.onPause?.());
    document.getElementById('wf-stop')?.addEventListener('click', () => callbacks.onStop?.());
    document.getElementById('wf-auto-layout')?.addEventListener('click', autoLayout);
    document.getElementById('wf-step')?.addEventListener('click', () => callbacks.onStep?.());
    document.getElementById('wf-simulate')?.addEventListener('click', () => callbacks.onSimulate?.());
    document.getElementById('wf-zoom-in')?.addEventListener('click', () => callbacks.onZoomIn?.());
    document.getElementById('wf-zoom-out')?.addEventListener('click', () => callbacks.onZoomOut?.());
    document.getElementById('wf-zoom-reset')?.addEventListener('click', () => callbacks.onZoomReset?.());
    document.getElementById('wf-memory-settings')?.addEventListener('click', () => callbacks.onMemorySettings?.());
    document.getElementById('wf-knowledge-settings')?.addEventListener('click', () => callbacks.onKnowledgeSettings?.());

    // Import .md workflow
    document.getElementById('wf-import-md-btn')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const content = await file.text();
        try {
          const store = window.Store || {};
          const res = await API.importWorkflowMd(content, null, store.get?.('currentWorkspaceId'));
          if (res.success) {
            Toast.success('工作流导入成功');
            if (res.data?.id) {
              window.location.hash = `#/workflows/${res.data.id}/edit`;
            }
          }
        } catch (err) {
          Toast.error('导入失败: ' + (err.message || '未知错误'));
        }
      };
      input.click();
    });

    // Export .md workflow
    document.getElementById('wf-export-md-btn')?.addEventListener('click', async () => {
      if (!callbacks.onGetCurrentWorkflowId) return;
      const wfId = callbacks.onGetCurrentWorkflowId();
      if (!wfId) {
        Toast.warning('请先保存工作流');
        return;
      }
      try {
        const url = API.getWorkflowExportMdUrl(wfId);
        const key = localStorage.getItem('claude_console_api_key') || '';
        const res = await fetch(url, { headers: { 'X-API-Key': key } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        const wfName = callbacks.onGetCurrentWorkflowName?.() || 'workflow';
        a.download = `${wfName}.md`;
        a.click();
        URL.revokeObjectURL(blobUrl);
        Toast.success('工作流已导出');
      } catch (err) {
        Toast.error('导出失败: ' + (err.message || '未知错误'));
      }
    });
  }

  function autoLayout() {
    const nodes = WorkflowCanvas.getNodes();
    const edges = WorkflowCanvas.getEdges();
    if (nodes.length === 0) return;

    // Build adjacency and indegree for topological layout
    const adj = {};
    const indegree = {};
    nodes.forEach(n => { adj[n.id] = []; indegree[n.id] = 0; });
    edges.forEach(e => {
      if (adj[e.source]) adj[e.source].push(e.target);
      if (indegree[e.target] !== undefined) indegree[e.target]++;
    });

    // BFS to assign layers (visited set prevents re-queuing)
    const layers = {};
    const visited = {};
    const queue = [];
    nodes.forEach(n => {
      if (indegree[n.id] === 0) { queue.push(n.id); layers[n.id] = 0; visited[n.id] = true; }
    });
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const next of (adj[cur] || [])) {
        const newLayer = (layers[cur] || 0) + 1;
        if (layers[next] === undefined || newLayer > layers[next]) {
          layers[next] = newLayer;
          if (!visited[next]) { visited[next] = true; queue.push(next); }
        }
      }
    }
    // Assign remaining nodes (cycles)
    nodes.forEach(n => { if (layers[n.id] === undefined) layers[n.id] = 0; });

    // Group by layer
    const layerGroups = {};
    nodes.forEach(n => {
      const l = layers[n.id];
      if (!layerGroups[l]) layerGroups[l] = [];
      layerGroups[l].push(n);
    });

    // Position: each layer is a column, nodes stacked vertically
    const LAYER_GAP = 260;
    const NODE_GAP = 120;
    const startX = 60;
    const startY = 60;

    Object.keys(layerGroups).sort((a, b) => a - b).forEach(layerIdx => {
      const group = layerGroups[layerIdx];
      group.forEach((node, rowIdx) => {
        node.position = {
          x: startX + parseInt(layerIdx) * LAYER_GAP,
          y: startY + rowIdx * NODE_GAP
        };
      });
    });

    WorkflowCanvas.loadWorkflow({ nodes, edges });
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  return { render, init };
})();
