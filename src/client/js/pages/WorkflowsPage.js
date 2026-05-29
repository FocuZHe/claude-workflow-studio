// ═══════════════════════════════════════════════
// Workflows Page — List + Canvas Builder
// ═══════════════════════════════════════════════

window.WorkflowsPage = (() => {
  let workflows = [];
  let currentWorkflow = null;
  let viewMode = 'list'; // 'list' | 'builder'
  let statusPollTimer = null;
  let executionData = null;
  let currentWorkspaceFilter = null; // null = show all, string = workspaceId
  let allWorkspaces = []; // cache for workspace list
  let _wsUnsubs = [];
  let _selectionMode = false;
  let _selectedIds = new Set();
  let _hasUnsavedChanges = false;
  let _isDraft = false;
  let _roMouseDown = null;
  let _roMouseMove = null;
  let _roMouseUp = null;
  let _roWheel = null;
  const PAGE_SIZE = 20;
  let currentPage = 1;

  async function render() {
    // Register before-leave guard for unsaved builder changes
    Router.setBeforeLeave(async (newPath) => {
      if (!_hasUnsavedChanges || viewMode !== 'builder') return true;
      const choice = await new Promise(resolve => {
        Modal.open({
          title: '未保存的更改',
          body: `<p style="color:var(--text-secondary);">当前工作流有未保存的更改，是否保存后再离开？</p>${_isDraft ? '<p style="color:var(--accent-amber);font-size:12px;margin-top:8px;">注意：创建工作流时未保存就离开，将不会创建到本地。</p>' : ''}`,
          footer: `
            <button class="btn btn-secondary" data-leave-choice="save">是（保存离开）</button>
            <button class="btn btn-secondary" data-leave-choice="discard">否（不保存离开）</button>
            <button class="btn btn-primary" data-leave-choice="cancel">取消</button>
          `,
          onClose: () => resolve('cancel')
        });
        const footer = document.querySelector('.modal-footer');
        if (footer) {
          footer.querySelectorAll('[data-leave-choice]').forEach(btn => {
            btn.addEventListener('click', () => {
              resolve(btn.dataset.leaveChoice);
              Modal.close();
            });
          });
        } else {
          resolve('cancel');
        }
      });
      if (choice === 'save') {
        await saveWorkflow();
        return true;
      } else if (choice === 'discard') {
        _hasUnsavedChanges = false;
        _isDraft = false;
        return true;
      }
      return false;
    });

    // If navigated from WorkspacesPage with a workspace filter, apply it
    const storedWsId = Store.get('activeWorkspaceId');
    if (storedWsId) {
      currentWorkspaceFilter = storedWsId;
      Store.set('activeWorkspaceId', null); // consume it
    }

    const el = document.getElementById('content');
    el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">${Icon.svg('workflow', 20)}</span> 工作流</h1>
          <div class="page-actions">
            <button class="btn btn-primary" id="create-wf-btn">+ 新建工作流</button>
            <button class="btn btn-secondary" id="create-wf-nl-btn">AI 创建</button>
            <button class="btn btn-secondary${viewMode === 'list' ? ' active' : ''}" id="wf-list-btn">列表</button>
            <button class="btn btn-secondary${viewMode === 'builder' ? ' active' : ''}" id="wf-builder-btn">构建器</button>
            <button class="btn btn-secondary" id="export-wf-btn">导出工作流</button>
            <button class="btn btn-secondary" id="import-wf-btn">导入工作流</button>
            <button class="btn btn-secondary" id="wf-batch-select-btn">批量选择</button>
          </div>
        </div>
        <div id="wf-workspace-indicator"></div>
        <div id="wf-workspace-tabs"></div>
        <div id="wf-content" style="flex:1;min-height:0;display:flex;flex-direction:column;"></div>
      </div>
    `;

    document.getElementById('create-wf-btn').addEventListener('click', createWorkflow);
    document.getElementById('export-wf-btn').addEventListener('click', exportSelectedWorkflows);
    document.getElementById('import-wf-btn').addEventListener('click', importWorkflowsFromFile);
    document.getElementById('create-wf-nl-btn').addEventListener('click', createWorkflowFromNL);
    document.getElementById('wf-batch-select-btn').addEventListener('click', toggleSelectionMode);
    document.getElementById('wf-list-btn').addEventListener('click', () => {
      tryLeaveBuilder(() => { viewMode = 'list'; stopStatusPolling(); render(); });
    });
    document.getElementById('wf-builder-btn').addEventListener('click', () => { viewMode = 'builder'; render(); });

    // Clean up previous listeners
    _wsUnsubs.forEach(fn => fn());
    _wsUnsubs = [];

    _wsUnsubs.push(WS.on('workflow.statusUpdate', onWorkflowUpdate));
    _wsUnsubs.push(WS.on('workflow.nodeUpdate', onNodeUpdate));
    _wsUnsubs.push(WS.on('workspace.changed', onWorkspaceChanged));

    // Listen for WebSocket reconnection to refresh data (remove first to prevent duplicates)
    window.removeEventListener('ws:reconnected', _onReconnect);
    window.addEventListener('ws:reconnected', _onReconnect);

    await loadWorkflows();
    await loadWorkspaceIndicator();
    await renderWorkspaceTabs();
    renderContent();
  }

  async function loadWorkflows() {
    try {
      const res = await API.getWorkflows({ limit: 9999 });
      const d = res.data;
      workflows = Array.isArray(d) ? d : (d?.items || []);
      // 通知其他页面工作流数据已更新
      if (typeof Store !== 'undefined') Store.set('workflowsDirty', Date.now());
    } catch (e) {
      Toast.error('加载工作流失败');
    }
  }

  async function loadWorkspaceIndicator() {
    const el = document.getElementById('wf-workspace-indicator');
    if (!el) return;
    try {
      const res = await API.getWorkspaceInfo();
      const wsPath = res?.data?.path || '';
      const recentWorkspaces = res?.data?.recentWorkspaces || [];
      // 存入 Store 供 FilesPage 直接读取，保证数量一致
      if (typeof Store !== 'undefined') {
        Store.set('totalWorkflowCount', workflows.length);
      }

      let recentHtml = '';
      if (recentWorkspaces.length > 1) {
        const otherWorkspaces = recentWorkspaces.filter(ws => {
          const wsPathItem = typeof ws === 'string' ? ws : ws.path;
          return wsPathItem !== wsPath;
        }).slice(0, 3);
        if (otherWorkspaces.length > 0) {
          recentHtml = `
            <span style="color:var(--text-muted);margin-left:8px;">最近:</span>
            ${otherWorkspaces.map(ws => {
              const wsP = typeof ws === 'string' ? ws : ws.path;
              const wsN = typeof ws === 'string' ? ws.split(/[\\/]/).pop() : (ws.name || wsP.split(/[\\/]/).pop());
              return `<span class="wf-recent-ws filter-chip" data-path="${escapeHtml(wsP)}" style="font-family:var(--font-mono);font-size:11px;background:var(--bg-deep);border-radius:4px;padding:2px 6px;color:var(--text-tertiary);">${escapeHtml(wsN)}</span>`;
            }).join('')}
          `;
        }
      }

      el.innerHTML = `
        <div class="workspace-bar">
          <span style="color:var(--text-muted);">当前工作区:</span>
          <span style="color:${wsPath ? 'var(--text-secondary)' : 'var(--text-muted)'};font-family:var(--font-mono);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${wsPath ? escapeHtml(wsPath) : '无工作区'}</span>
          <span style="color:var(--accent-cyan);white-space:nowrap;">${workflows.length} 个工作流</span>
          ${recentHtml}
        </div>
      `;

      // Bind click events for recent workspace items
      el.querySelectorAll('.wf-recent-ws').forEach(item => {
        item.addEventListener('click', async () => {
          const targetPath = item.dataset.path;
          if (!targetPath) return;
          // 检查未保存更改
          if (_hasUnsavedChanges && viewMode === 'builder') {
            const choice = await new Promise(resolve => {
              Modal.open({
                title: '切换工作区',
                body: '当前工作流有未保存的更改。切换工作区后将丢失这些更改。',
                footer: `
                  <button class="btn btn-secondary" id="ws-recent-cancel">取消</button>
                  <button class="btn btn-primary" id="ws-recent-confirm">确认切换</button>
                `
              });
              setTimeout(() => {
                document.getElementById('ws-recent-cancel')?.addEventListener('click', () => resolve('cancel'));
                document.getElementById('ws-recent-confirm')?.addEventListener('click', () => resolve('confirm'));
              }, 0);
            });
            if (choice === 'cancel') return;
            _hasUnsavedChanges = false;
          }
          try {
            await API.setWorkspace(targetPath);
            Toast.success('工作区已切换');
            if (typeof Navbar !== 'undefined' && Navbar.loadCurrentWorkspace) {
              Navbar.loadCurrentWorkspace();
            }
            currentWorkflow = null;
            viewMode = 'list';
            stopStatusPolling();
            await render();
          } catch (e) {
            Toast.error(e.message || '切换工作区失败');
          }
        });
      });
    } catch (e) {
      el.innerHTML = '';
    }
  }

  async function renderWorkspaceTabs() {
    // 不再显示分类标签按钮，改为自动识别当前工作区
    try {
      const res = await API.getWorkspaces();
      allWorkspaces = res.data || [];
    } catch (e) {
      allWorkspaces = [];
    }

    // 自动匹配当前活跃工作区
    try {
      const info = await API.getWorkspaceInfo();
      const wsPath = info?.data?.path;
      if (wsPath && allWorkspaces.length > 0) {
        const currentWs = allWorkspaces.find(ws => ws.path === wsPath);
        currentWorkspaceFilter = currentWs ? currentWs.id : null;
      }
    } catch (e) { /* 保持现有过滤 */ }

    const tabsEl = document.getElementById('wf-workspace-tabs');
    if (tabsEl) tabsEl.innerHTML = '';
  }

  function getWorkspaceName(workspaceId) {
    if (!workspaceId || allWorkspaces.length === 0) return null;
    const ws = allWorkspaces.find(w => w.id === workspaceId);
    return ws ? (ws.name || ws.path.split(/[/\\]/).pop()) : null;
  }

  function getFilteredWorkflows() {
    // 服务器端 setWorkspaceRoot() 已确保内存中只有当前工作区的工作流，无需前端再次过滤
    return workflows;
  }

  function updateViewModeButtons() {
    const listBtn = document.getElementById('wf-list-btn');
    const builderBtn = document.getElementById('wf-builder-btn');
    if (listBtn) listBtn.classList.toggle('active', viewMode === 'list');
    if (builderBtn) builderBtn.classList.toggle('active', viewMode === 'builder' || viewMode === 'readonly');
  }

  function renderContent() {
    const container = document.getElementById('wf-content');
    if (!container) return;

    updateViewModeButtons();

    if (viewMode === 'list') {
      renderListView(container);
    } else if (viewMode === 'readonly') {
      renderReadOnlyView(container);
    } else {
      renderBuilderView(container);
    }
  }

  async function tryLeaveBuilder(action) {
    if (!_hasUnsavedChanges || viewMode !== 'builder') {
      action();
      return;
    }
    const choice = await new Promise(resolve => {
      Modal.open({
        title: '未保存的更改',
        body: `<p style="color:var(--text-secondary);">当前工作流有未保存的更改，是否保存后再离开？</p>${_isDraft ? '<p style="color:var(--accent-amber);font-size:12px;margin-top:8px;">注意：创建工作流时未保存就离开，将不会创建到本地。</p>' : ''}`,
        footer: `
          <button class="btn btn-secondary" data-leave-choice="save">是（保存离开）</button>
          <button class="btn btn-secondary" data-leave-choice="discard">否（不保存离开）</button>
          <button class="btn btn-primary" data-leave-choice="cancel">取消</button>
        `,
        onClose: () => resolve('cancel')
      });
      const footer = document.querySelector('.modal-footer');
      if (footer) {
        footer.querySelectorAll('[data-leave-choice]').forEach(btn => {
          btn.addEventListener('click', () => {
            resolve(btn.dataset.leaveChoice);
            Modal.close();
          });
        });
      } else {
        resolve('cancel');
      }
    });
    if (choice === 'save') {
      await saveWorkflow();
      action();
    } else if (choice === 'discard') {
      _hasUnsavedChanges = false;
      _isDraft = false;
      action();
    }
    // 'cancel' does nothing
  }

  function renderListView(container) {
    stopStatusPolling();

    const displayWorkflows = getFilteredWorkflows();

    if (workflows.length === 0) {
      container.innerHTML = EmptyState.render({
        icon: Icon.svg('workflow', 24),
        title: '还没有工作流',
        description: '创建工作流来编排多 Agent 协作流程',
        actionText: '+ 新建工作流',
        actionId: 'empty-create-wf-btn'
      });
      document.getElementById('empty-create-wf-btn')?.addEventListener('click', createWorkflow);
      const paginationEl = document.getElementById('wf-pagination');
      if (paginationEl) paginationEl.innerHTML = '';
      return;
    }

    if (displayWorkflows.length === 0) {
      container.innerHTML = EmptyState.render({
        icon: Icon.svg('workflow', 24),
        title: '当前工作区无工作流',
        description: '创建工作流或切换到其他工作区',
        actionText: '+ 新建工作流',
        actionId: 'empty-create-wf-btn-ws'
      });
      document.getElementById('empty-create-wf-btn-ws')?.addEventListener('click', createWorkflow);
      const paginationEl = document.getElementById('wf-pagination');
      if (paginationEl) paginationEl.innerHTML = '';
      return;
    }

    // Pagination
    const totalPages = Math.ceil(displayWorkflows.length / PAGE_SIZE);
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const paged = displayWorkflows.slice(start, start + PAGE_SIZE);

    container.innerHTML = `
      <div class="grid-3 stagger">
        ${paged.map(wf => {
          const checkboxHtml = _selectionMode ? `<div style="position:absolute;top:12px;left:12px;z-index:10;"><input type="checkbox" class="batch-checkbox" data-id="${wf.id}" ${_selectedIds.has(wf.id) ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent-cyan);"></div>` : '';
          return `
          <div class="card card-workflow hover-lift card-enter" data-id="${wf.id}" style="position:relative;${_selectionMode ? 'padding-left:40px;' : ''}">
            ${checkboxHtml}
            <div class="card-header">
              <div class="card-title">${escapeHtml(wf.name)}</div>
              ${StatusBadge.render(wf.executionStatus || wf.status)}
            </div>
            <div class="card-body">
              <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:8px;">
                ${escapeHtml(wf.description || '暂无描述')}
              </div>
              <div style="display:flex;gap:12px;align-items:center;font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">
                <span>${(wf.nodes || []).length} 个节点</span>
                <span>${(wf.edges || []).length} 条边</span>
              </div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;">
              <button class="btn btn-sm btn-secondary wf-edit" data-id="${wf.id}">${Icon.svg('edit', 14)} 编辑</button>
              <button class="btn btn-sm btn-secondary wf-rename" data-id="${wf.id}" title="重命名">${Icon.svg('rename', 14)}</button>
              <button class="btn btn-sm btn-secondary wf-view-status" data-id="${wf.id}" title="查看状态">${Icon.svg('eye', 14)}</button>
              <button class="btn btn-sm btn-danger wf-delete" data-id="${wf.id}">${Icon.svg('delete', 14)}</button>
            </div>
          </div>
        `}).join('')}
      </div>
    `;

    container.querySelectorAll('.wf-edit').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); editWorkflow(b.dataset.id); }));
    container.querySelectorAll('.wf-rename').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); renameWorkflow(b.dataset.id); }));
    container.querySelectorAll('.wf-delete').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); deleteWorkflow(b.dataset.id); }));
    container.querySelectorAll('.wf-view-status').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); viewWorkflowStatus(b.dataset.id); }));
    container.querySelectorAll('.wf-resume-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        try {
          const res = await API.resumeWorkflowFromCheckpoint(id);
          Toast.success('工作流已从检查点恢复');
          await loadWorkflows();
          renderContent();
        } catch (err) {
          Toast.error('恢复失败: ' + err.message);
        }
      });
    });

    container.querySelectorAll('.wf-skip-failed-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        openSkipFailedModal(id);
      });
    });

    // Batch checkbox events
    container.querySelectorAll('.batch-checkbox').forEach(cb => {
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSelectItem(cb.dataset.id);
      });
    });

    // Render pagination controls
    renderWfPagination(displayWorkflows.length, totalPages);
  }

  function renderWfPagination(total, totalPages) {
    let paginationEl = document.getElementById('wf-pagination');
    if (!paginationEl) {
      const container = document.getElementById('wf-content');
      if (!container) return;
      paginationEl = document.createElement('div');
      paginationEl.id = 'wf-pagination';
      paginationEl.className = 'pagination-info';
      container.appendChild(paginationEl);
    }

    if (totalPages <= 1) {
      paginationEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">显示 ${total} / ${total} 条</span>`;
      return;
    }

    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, total);
    paginationEl.innerHTML = `
      <span style="font-size:12px;color:var(--text-muted);">显示 ${start}-${end} / ${total} 条</span>
      <button class="btn btn-sm btn-ghost" id="wf-prev" ${currentPage <= 1 ? 'disabled' : ''}>上一页</button>
      <span style="font-size:12px;color:var(--text-muted);">第 ${currentPage} / ${totalPages} 页</span>
      <button class="btn btn-sm btn-ghost" id="wf-next" ${currentPage >= totalPages ? 'disabled' : ''}>下一页</button>
    `;

    document.getElementById('wf-prev')?.addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; renderContent(); }
    });
    document.getElementById('wf-next')?.addEventListener('click', () => {
      if (currentPage < totalPages) { currentPage++; renderContent(); }
    });
  }

  function renderBuilderView(container) {
    container.innerHTML = `
      <div style="display:flex;gap:16px;flex:1;min-height:0;">
        <div style="width:clamp(140px,16vw,200px);flex-shrink:0;">
          <div class="card" style="height:100%;overflow-y:auto;">
            <div class="card-header"><h3 class="card-title" style="font-size:13px;">工作流</h3></div>
            <div id="wf-sidebar-list">
              ${workflows.map(wf => `
                <div class="nav-item wf-sidebar-item ${currentWorkflow?.id === wf.id ? 'active' : ''}" data-id="${wf.id}" style="padding:8px 12px;font-size:12px;">
                  ${escapeHtml(wf.name)}
                </div>
              `).join('')}
              ${workflows.length === 0 ? '<div class="text-muted" style="font-size:12px;padding:8px;">暂无工作流</div>' : ''}
            </div>
          </div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;position:relative;">
          <div id="wf-toolbar" style="margin-bottom:8px;">
            ${WorkflowToolbar.render(currentWorkflow, executionData)}
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-size:11px;color:var(--text-muted);">工作文件夹:</span>
            <span id="wf-folder-path" style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${escapeHtml(currentWorkflow?.folderPath || '未设置')}
            </span>
            <button class="btn btn-sm btn-secondary" id="wf-select-folder">选择文件夹</button>
          </div>
          <div style="flex:1;min-height:0;display:flex;flex-direction:column;">
            ${WorkflowCanvas.render(currentWorkflow)}
          </div>
        </div>
      </div>
    `;

    container.querySelectorAll('.wf-sidebar-item').forEach(el => {
      el.addEventListener('click', async () => {
        const wf = workflows.find(w => w.id === el.dataset.id);
        if (wf && wf.id !== currentWorkflow?.id) {
          tryLeaveBuilder(async () => {
            try {
              const res = await API.getWorkflow(wf.id);
              currentWorkflow = res.data;
              executionData = null;
              renderContent();
            } catch (e) { Toast.error('加载工作流失败'); }
          });
        }
      });
    });

    // Bind folder selection events
    document.getElementById('wf-select-folder')?.addEventListener('click', selectWorkflowFolder);

    if (currentWorkflow) {
      WorkflowCanvas.init(currentWorkflow);
      // Don't reset _hasUnsavedChanges for drafts (already set by createWorkflow)
      if (!_isDraft) _hasUnsavedChanges = false;
      WorkflowCanvas.setOnEdit(() => { _hasUnsavedChanges = true; });
      initToolbar();

      // If workflow is running, start polling
      const execStatus = currentWorkflow.executionStatus || currentWorkflow.status;
      if (execStatus === 'running' || execStatus === 'paused') {
        startStatusPolling(currentWorkflow.id);
      }
    }
  }

  function initToolbar() {
    if (!currentWorkflow) return;
    WorkflowToolbar.init(currentWorkflow, executionData, {
      onSave: saveWorkflow,
      onRun: () => runWorkflow(currentWorkflow.id),
      onPause: () => pauseWorkflow(currentWorkflow.id),
      onStop: () => stopWorkflow(currentWorkflow.id),
      onAddNode: addNodeToWorkflow,
      onStep: () => stepWorkflow(currentWorkflow.id),
      onSimulate: () => simulateWorkflow(currentWorkflow.id),
      onZoomIn: () => WorkflowCanvas.zoomIn(),
      onZoomOut: () => WorkflowCanvas.zoomOut(),
      onZoomReset: () => WorkflowCanvas.zoomReset(),
      onMemorySettings: () => openMemorySettings(currentWorkflow),
      onKnowledgeSettings: () => openKnowledgeSettings(currentWorkflow),
      onGetCurrentWorkflowId: () => currentWorkflow?.id || null,
      onGetCurrentWorkflowName: () => currentWorkflow?.name || 'workflow',
    });
  }

  // ── Status Polling ──

  function startStatusPolling(workflowId) {
    stopStatusPolling();
    statusPollTimer = setInterval(async () => {
      try {
        const res = await API.getWorkflowExecution(workflowId);
        executionData = res.data;

        if (viewMode === 'readonly' && currentWorkflow && currentWorkflow.id === workflowId) {
          // Update node statuses from execution data
          const nodeStatuses = executionData?.nodeStatuses || {};
          const nodes = currentWorkflow.nodes || [];
          for (const [nodeId, nodeData] of Object.entries(nodeStatuses)) {
            const node = nodes.find(n => n.id === nodeId);
            if (node) {
              if (nodeData.status) node.status = nodeData.status;
              if (nodeData.output !== undefined) node.output = nodeData.output;
            }
          }
          if (executionData?.status) {
            currentWorkflow.executionStatus = executionData.status;
          }
          renderReadOnlyNodes(currentWorkflow);
          renderReadOnlyEdges(currentWorkflow);
          updateReadonlyProgress(currentWorkflow);
        } else {
          WorkflowCanvas.setExecutionData(executionData);
          updateToolbarProgress(executionData);
        }

        // Stop polling if execution is done
        const status = executionData?.status;
        if (status === 'completed' || status === 'failed' || status === 'stopped') {
          stopStatusPolling();
          // Update workflow status
          if (currentWorkflow && currentWorkflow.id === workflowId) {
            currentWorkflow.executionStatus = status;
            if (viewMode === 'readonly') {
              // Final re-render of read-only view
              API.getWorkflow(workflowId).then(r => {
                if (r.data) {
                  currentWorkflow = r.data;
                  renderReadOnlyNodes(currentWorkflow);
                  renderReadOnlyEdges(currentWorkflow);
                  updateReadonlyProgress(currentWorkflow);
                }
              }).catch(() => {});
            } else {
              refreshToolbar();
            }
          }
        }
      } catch (e) {
        console.warn('[Poll] 获取执行状态失败:', e.message);
      }
    }, 10000);
  }

  function stopStatusPolling() {
    if (statusPollTimer) {
      clearInterval(statusPollTimer);
      statusPollTimer = null;
    }
  }

  function updateToolbarProgress(data) {
    if (!data) return;
    const toolbarEl = document.getElementById('wf-toolbar');
    if (!toolbarEl) return;

    const progressFill = toolbarEl.querySelector('.wf-progress-fill');
    const progressText = toolbarEl.querySelector('.toolbar-group:last-of-type span:last-child');
    if (progressFill && data.progress !== undefined) {
      progressFill.style.width = data.progress + '%';
    }
    if (progressText && data.progress !== undefined) {
      progressText.textContent = data.progress + '%';
    }
  }

  function refreshToolbar() {
    const toolbarEl = document.getElementById('wf-toolbar');
    if (!toolbarEl || !currentWorkflow) return;
    toolbarEl.innerHTML = WorkflowToolbar.render(currentWorkflow, executionData);
    initToolbar();
  }

  // ── Workflow Actions ──

  async function createWorkflow() {
    const result = await new Promise((resolve) => {
      Modal.open({
        title: '新建工作流',
        body: `
          <div class="form-group">
            <label class="form-label">工作流名称</label>
            <input class="input" id="wf-name-input" placeholder="请输入工作流名称" maxlength="100">
          </div>
          <div style="margin-top:12px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
              <input type="checkbox" id="wf-create-all-ws"> 同时在所有工作区创建
            </label>
            <div style="font-size:11px;color:var(--text-muted);margin-left:24px;margin-top:2px;">勾选后将在所有已激活的工作区中创建相同的工作流</div>
          </div>
        `,
        footer: `
          <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
          <button class="btn btn-primary" id="wf-confirm-btn">创建</button>
        `,
      });
      document.getElementById('wf-confirm-btn').addEventListener('click', () => {
        const name = document.getElementById('wf-name-input')?.value.trim();
        if (!name) { Toast.warning('请输入工作流名称'); return; }
        const createAll = document.getElementById('wf-create-all-ws')?.checked || false;
        Modal.close();
        resolve({ name, createAll });
      });
    });
    if (!result) return;

    // Create a local draft workflow (not persisted yet)
    const draftId = 'draft_' + Date.now();
    currentWorkflow = {
      id: draftId,
      name: result.name,
      description: '',
      status: 'draft',
      nodes: [
        { id: 'n1', label: '开始', type: 'start', agentId: '', position: { x: 80, y: 200 }, config: {}, defaultPrompt: '', requiresInput: false, status: 'pending', output: null, startedAt: null, completedAt: null, logs: [] },
        { id: 'n2', label: '结束', type: 'end', agentId: '', position: { x: 540, y: 200 }, config: {}, defaultPrompt: '', requiresInput: false, status: 'pending', output: null, startedAt: null, completedAt: null, logs: [] }
      ],
      edges: [],
      executionLog: [],
      context: {},
      executionStatus: 'idle',
      currentRunId: null,
      _createAll: result.createAll
    };
    _isDraft = true;
    _hasUnsavedChanges = true;
    executionData = null;
    viewMode = 'builder';
    renderContent();
  }

  async function editWorkflow(id) {
    try {
      const res = await API.getWorkflow(id);
      currentWorkflow = res.data;
      executionData = null;
      viewMode = 'builder';
      renderContent();
    } catch (e) {
      Toast.error('加载工作流失败');
    }
  }

  async function renameWorkflow(id) {
    const wf = workflows.find(w => w.id === id);
    if (!wf) return;
    const newName = prompt('请输入新的工作流名称：', wf.name);
    if (!newName || !newName.trim() || newName.trim() === wf.name) return;
    try {
      await API.renameWorkflow(id, newName.trim());
      Toast.success('工作流已重命名');
      await loadWorkflows();
      renderContent();
    } catch (e) {
      Toast.error('重命名失败: ' + e.message);
    }
  }

  async function saveWorkflow() {
    if (!currentWorkflow) return;
    const btn = document.querySelector('#wf-toolbar .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
    try {
      const nodes = WorkflowCanvas.getNodes();
      const edges = WorkflowCanvas.getEdges();

      if (_isDraft) {
        // Draft: create via API
        const payload = { name: currentWorkflow.name, description: currentWorkflow.description, nodes, edges };
        if (currentWorkflow._createAll) {
          const res = await API.createWorkflowInAll(payload);
          Toast.success('工作流已在所有工作区创建');
          // Response contains only the current workspace's workflow
          if (res.data) {
            currentWorkflow = res.data;
          }
        } else {
          const res = await API.createWorkflow(payload);
          currentWorkflow = res.data;
          Toast.success('工作流已创建');
        }
        _isDraft = false;
      } else {
        // Existing: update via API
        await API.updateWorkflow(currentWorkflow.id, { nodes, edges });
        currentWorkflow.nodes = nodes;
        currentWorkflow.edges = edges;
        Toast.success('工作流已保存');
      }

      _hasUnsavedChanges = false;
      await loadWorkflows();
    } catch (e) {
      Toast.error(e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '保存'; }
    }
  }

  // ── Skip Failed Node ──
  async function openSkipFailedModal(workflowId) {
    try {
      const res = await API.getWorkflow(workflowId);
      const wf = res.data;
      if (!wf) { Toast.error('工作流不存在'); return; }

      const failedNodes = (wf.nodes || []).filter(n => n.status === 'failed');
      if (failedNodes.length === 0) {
        Toast.warning('没有失败的节点');
        return;
      }

      const errorInfo = wf.lastError;
      const errorTypeMap = {
        'TOKEN_EXHAUSTED': { icon: Icon.svg('warning', 16), label: 'Token 额度耗尽', color: 'var(--accent-amber)' },
        'RATE_LIMITED': { icon: Icon.svg('spinner', 16), label: '请求频率超限', color: 'var(--accent-amber)' },
        'BILLING_ERROR': { icon: Icon.svg('error', 16), label: '账户余额不足', color: 'var(--accent-red)' },
        'AUTH_ERROR': { icon: Icon.svg('error', 16), label: '认证失败', color: 'var(--accent-red)' },
        'SERVICE_OVERLOADED': { icon: Icon.svg('warning', 16), label: '服务过载', color: 'var(--accent-amber)' },
        'CONTEXT_TOO_LONG': { icon: Icon.svg('error', 16), label: '内容超出限制', color: 'var(--accent-red)' },
        'EXECUTION_ERROR': { icon: Icon.svg('warning', 16), label: '执行错误', color: 'var(--accent-red)' }
      };
      const errCfg = errorTypeMap[errorInfo?.type] || errorTypeMap['EXECUTION_ERROR'];

      const nodeListHtml = failedNodes.map(n => `
        <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:6px;border:1px solid var(--border-subtle);border-radius:6px;background:var(--bg-deep);cursor:pointer;">
          <input type="checkbox" class="skip-node-cb" data-node-id="${escapeHtml(n.id)}" checked style="width:16px;height:16px;accent-color:var(--accent-cyan);">
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:500;color:var(--text-primary);">${escapeHtml(n.label || n.id)}</div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">${escapeHtml(n.type)} · ${escapeHtml((n.output || '').substring(0, 80))}</div>
          </div>
        </label>
      `).join('');

      Modal.open({
        title: '跳过失败节点继续执行',
        body: `
          <div style="margin-bottom:12px;padding:10px 12px;border-radius:6px;background:rgba(255,165,0,0.1);border:1px solid rgba(255,165,0,0.3);">
            <div style="font-size:13px;font-weight:600;color:${errCfg.color};">${errCfg.icon} ${errCfg.label}</div>
            ${errorInfo?.message ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${escapeHtml(errorInfo.message.substring(0, 200))}</div>` : ''}
            ${errorInfo?.retryable ? '<div style="font-size:11px;color:var(--accent-green);margin-top:4px;">此错误通常可重试，修复问题后可直接运行恢复</div>' : ''}
          </div>
          <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:8px;">选择要跳过的失败节点（跳过后下游节点将重新执行）：</div>
          <div style="max-height:250px;overflow-y:auto;">${nodeListHtml}</div>
        `,
        footer: `
          <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
          ${errorInfo?.retryable ? `<button class="btn btn-primary" id="skip-retry-btn">修复后重试</button>` : ''}
          <button class="btn btn-warning" id="skip-confirm-btn">跳过选中节点</button>
        `
      });

      document.getElementById('skip-confirm-btn')?.addEventListener('click', async () => {
        const selectedIds = Array.from(document.querySelectorAll('.skip-node-cb:checked')).map(cb => cb.dataset.nodeId);
        if (selectedIds.length === 0) {
          Toast.warning('请至少选择一个节点');
          return;
        }
        try {
          for (const nodeId of selectedIds) {
            await API.skipWorkflowNode(workflowId, nodeId);
          }
          Toast.success(`已跳过 ${selectedIds.length} 个节点，工作流继续执行`);
          Modal.close();
          await loadWorkflows();
          renderContent();
        } catch (e) {
          Toast.error('跳过失败: ' + e.message);
        }
      });

      document.getElementById('skip-retry-btn')?.addEventListener('click', () => {
        Modal.close();
        Toast.info('请修复问题后点击"运行"按钮重新执行，将自动从检查点恢复');
      });
    } catch (e) {
      Toast.error('加载工作流信息失败: ' + e.message);
    }
  }

  // ── Memory Settings ──
  async function openMemorySettings(workflow) {
    if (!workflow) return;
    const memSource = workflow.memorySource || {};

    // Load all workflows for selection
    let allWorkflows = [];
    try {
      const res = await API.getWorkflows({ limit: 9999 });
      allWorkflows = (res.data?.items || res.data || []).filter(w => w.id !== workflow.id);
    } catch (e) { /* ignore */ }

    Modal.open({
      title: '记忆传递设置',
      body: `
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">
          选择此工作流执行时要注入的记忆来源。默认不注入其他工作流的记忆。
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <label style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--border-subtle);border-radius:6px;cursor:pointer;">
            <input type="radio" name="mem-source" value="none" ${!memSource.type ? 'checked' : ''}>
            <span>不注入（默认）</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--border-subtle);border-radius:6px;cursor:pointer;">
            <input type="radio" name="mem-source" value="all" ${memSource.type === 'all' ? 'checked' : ''}>
            <span>注入所有工作流的记忆</span>
          </label>
          <div style="padding:8px;border:1px solid var(--border-subtle);border-radius:6px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:6px;">
              <input type="radio" name="mem-source" value="workflow" ${memSource.type === 'workflow' ? 'checked' : ''}>
              <span>注入指定工作流的记忆</span>
            </label>
            <select class="select" id="mem-source-workflow" style="width:100%;margin-left:24px;" ${memSource.type !== 'workflow' ? 'disabled' : ''}>
              <option value="">请选择工作流...</option>
              ${allWorkflows.map(w => `<option value="${w.id}" ${memSource.workflowId === w.id ? 'selected' : ''}>${escapeHtml(w.name)}</option>`).join('')}
            </select>
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="mem-save-btn">保存</button>
      `
    });

    // Enable/disable select based on radio
    document.querySelectorAll('[name="mem-source"]').forEach(radio => {
      radio.addEventListener('change', () => {
        document.getElementById('mem-source-workflow').disabled = radio.value !== 'workflow';
      });
    });

    document.getElementById('mem-save-btn')?.addEventListener('click', async () => {
      const selected = document.querySelector('[name="mem-source"]:checked')?.value;
      let newSource = null;
      if (selected === 'all') {
        newSource = { type: 'all' };
      } else if (selected === 'workflow') {
        const wfId = document.getElementById('mem-source-workflow')?.value;
        if (!wfId) { Toast.warning('请选择一个工作流'); return; }
        newSource = { type: 'workflow', workflowId: wfId };
      }
      try {
        await API.updateWorkflow(workflow.id, { memorySource: newSource });
        workflow.memorySource = newSource;
        Toast.success('记忆设置已保存');
        Modal.close();
      } catch (e) {
        Toast.error('保存失败: ' + e.message);
      }
    });
  }

  // ── Knowledge Settings ──
  async function openKnowledgeSettings(workflow) {
    if (!workflow) return;
    const knSource = workflow.knowledgeSource || {};

    // Load knowledge entries
    let entries = [];
    try {
      const res = await API.searchKnowledge('', { limit: 100 });
      entries = res.data?.items || res.data || [];
    } catch (e) { /* ignore */ }

    const categories = [...new Set(entries.map(e => e.category).filter(Boolean))];
    const selectedIds = knSource.type === 'entries' ? (knSource.entryIds || []) : [];
    const selectedCat = knSource.type === 'category' ? (knSource.category || '') : '';

    Modal.open({
      title: '知识库注入设置',
      body: `
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">
          选择执行时要注入给 Agent 的知识条目。默认不注入。
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:400px;overflow-y:auto;">
          <label style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--border-subtle);border-radius:6px;cursor:pointer;">
            <input type="radio" name="kn-source" value="none" ${!knSource.type ? 'checked' : ''}>
            <span>不注入（默认）</span>
          </label>

          <div style="padding:8px;border:1px solid var(--border-subtle);border-radius:6px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:6px;">
              <input type="radio" name="kn-source" value="category" ${knSource.type === 'category' ? 'checked' : ''}>
              <span>按分类注入</span>
            </label>
            <select class="select" id="kn-category" style="width:100%;margin-left:24px;" ${knSource.type !== 'category' ? 'disabled' : ''}>
              <option value="">请选择分类...</option>
              ${categories.map(c => `<option value="${c}" ${selectedCat === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
            </select>
          </div>

          <div style="padding:8px;border:1px solid var(--border-subtle);border-radius:6px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:6px;">
              <input type="radio" name="kn-source" value="entries" ${knSource.type === 'entries' ? 'checked' : ''}>
              <span>选择具体条目</span>
            </label>
            <div id="kn-entries-list" style="margin-left:24px;max-height:200px;overflow-y:auto;${knSource.type !== 'entries' ? 'opacity:0.5;pointer-events:none;' : ''}">
              ${entries.length === 0 ? '<div style="color:var(--text-muted);font-size:12px;">暂无知识条目</div>' :
                entries.map(e => `
                  <label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12px;cursor:pointer;">
                    <input type="checkbox" class="kn-entry-cb" value="${e.id}" ${selectedIds.includes(e.id) ? 'checked' : ''}>
                    <span>${escapeHtml(e.title)}</span>
                    <span style="color:var(--text-muted);font-size:10px;">(${escapeHtml(e.category || '')})</span>
                  </label>
                `).join('')}
            </div>
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="kn-save-btn">保存</button>
      `
    });

    // Enable/disable based on radio
    document.querySelectorAll('[name="kn-source"]').forEach(radio => {
      radio.addEventListener('change', () => {
        document.getElementById('kn-category').disabled = radio.value !== 'category';
        const list = document.getElementById('kn-entries-list');
        if (list) {
          list.style.opacity = radio.value === 'entries' ? '1' : '0.5';
          list.style.pointerEvents = radio.value === 'entries' ? 'auto' : 'none';
        }
      });
    });

    document.getElementById('kn-save-btn')?.addEventListener('click', async () => {
      const selected = document.querySelector('[name="kn-source"]:checked')?.value;
      let newSource = null;
      if (selected === 'category') {
        const cat = document.getElementById('kn-category')?.value;
        if (!cat) { Toast.warning('请选择一个分类'); return; }
        newSource = { type: 'category', category: cat };
      } else if (selected === 'entries') {
        const ids = [...document.querySelectorAll('.kn-entry-cb:checked')].map(cb => cb.value);
        if (ids.length === 0) { Toast.warning('请至少选择一个条目'); return; }
        newSource = { type: 'entries', entryIds: ids };
      }
      try {
        await API.updateWorkflow(workflow.id, { knowledgeSource: newSource });
        workflow.knowledgeSource = newSource;
        Toast.success('知识库设置已保存');
        Modal.close();
      } catch (e) {
        Toast.error('保存失败: ' + e.message);
      }
    });
  }

  async function runWorkflow(id) {
    const wf = workflows.find(w => w.id === id);
    const wfName = wf ? wf.name : '未知工作流';

    // Check if workflow has a checkpoint (was interrupted or failed with checkpoint)
    if (wf && (wf.executionStatus === 'interrupted' || wf.executionStatus === 'failed')) {
      try {
        const cpRes = await API.getWorkflowCheckpoints(id);
        const checkpoints = cpRes.data || [];
        if (checkpoints.length > 0) {
          const latestCp = checkpoints[checkpoints.length - 1];
          Modal.open({
            title: '检测到检查点',
            body: `
              <div style="margin-bottom:12px;font-size:13px;color:var(--text-secondary);">
                工作流 <strong>${escapeHtml(wfName)}</strong> 之前执行中断，有检查点可用。
              </div>
              <div style="padding:10px 12px;border-radius:6px;background:var(--bg-deep);border:1px solid var(--border-subtle);margin-bottom:12px;">
                <div style="font-size:12px;color:var(--text-muted);">检查点时间: ${new Date(latestCp.timestamp).toLocaleString('zh-CN')}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">已完成节点: ${latestCp.completedCount || 0} 个</div>
              </div>
              <div style="font-size:12px;color:var(--text-tertiary);">
                选择"从检查点恢复"将跳过已完成的节点，从断点继续执行。<br>
                选择"重新运行"将从头开始执行所有节点。
              </div>
            `,
            footer: `
              <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
              <button class="btn btn-secondary" id="run-fresh-btn">重新运行</button>
              <button class="btn btn-primary" id="run-resume-btn">从检查点恢复</button>
            `
          });

          document.getElementById('run-resume-btn')?.addEventListener('click', async () => {
            Modal.close();
            try {
              const res = await API.resumeWorkflowFromCheckpoint(id, latestCp);
              Toast.success('已从检查点恢复执行');
              currentWorkflow.executionStatus = 'running';
              await loadWorkflows();
              renderContent();
              startStatusPolling(id);
            } catch (e) {
              Toast.error('恢复失败: ' + e.message);
            }
          });

          document.getElementById('run-fresh-btn')?.addEventListener('click', () => {
            Modal.close();
            // Continue with normal run flow below
            showRunDialog(id, wf, wfName);
          });
          return;
        }
      } catch (e) { /* no checkpoints, proceed with normal run */ }
    }

    showRunDialog(id, wf, wfName);
  }

  async function showRunDialog(id, wf, wfName) {
    // Check for nodes that require input
    let inputRequiredNodes = [];
    try {
      const inputRes = await API.getWorkflowInputRequired(id);
      inputRequiredNodes = inputRes.data || [];
    } catch (e) {
      // If endpoint fails, proceed without input requirement
    }

    // Build input fields for nodes that require user input
    let nodeInputsHtml = '';
    if (inputRequiredNodes.length > 0) {
      nodeInputsHtml = `
        <div style="margin-bottom:16px;padding:12px;background:rgba(0,210,255,0.05);border:1px solid rgba(0,210,255,0.15);border-radius:var(--border-radius);">
          <div style="font-size:12px;font-weight:600;color:var(--accent-cyan);margin-bottom:8px;">
            需要输入工作内容的节点 (${inputRequiredNodes.length})
          </div>
          ${inputRequiredNodes.map(node => `
            <div style="margin-bottom:12px;">
              <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">
                <strong>${escapeHtml(node.label)}</strong>
                ${node.defaultPrompt ? `<span style="color:var(--text-muted);font-size:11px;"> — 默认提示词已配置</span>` : ''}
              </div>
              ${node.defaultPrompt ? `
                <div style="font-size:11px;color:var(--text-muted);padding:6px 8px;background:var(--bg-deep);border-radius:4px;margin-bottom:6px;max-height:60px;overflow-y:auto;white-space:pre-wrap;">${escapeHtml(node.defaultPrompt)}</div>
              ` : ''}
              <textarea class="run-node-input" data-node-id="${node.nodeId}" rows="3"
                        placeholder="输入本次工作内容，将与默认提示词拼接后传递给 Agent"
                        style="width:100%;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;font-family:var(--font-mono);resize:vertical;"></textarea>
            </div>
          `).join('')}
        </div>
      `;
    }

    Modal.open({
      title: '运行工作流',
      body: `
        <div>
          <div style="margin-bottom:12px;font-size:13px;color:var(--text-secondary);">
            工作流: <strong>${escapeHtml(wfName)}</strong>
          </div>
          ${nodeInputsHtml}
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer;font-size:12px;">
            <input type="checkbox" id="run-batch-mode"> 批量模式
          </label>
          <div id="run-single-params">
            <div class="form-group">
              <div class="form-label">运行参数</div>
              <textarea id="run-params-input" rows="6" placeholder="输入运行参数（JSON格式），可留空"
                        style="width:100%;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;font-family:var(--font-mono);resize:vertical;"></textarea>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
              提示: 输入 JSON 格式的运行参数，如 {"key": "value"}，可留空
            </div>
          </div>
          <div id="run-batch-params" style="display:none;">
            <div class="form-group">
              <div class="form-label">批量参数（每行一组 JSON）</div>
              <textarea id="run-batch-input" rows="8" placeholder='每行一组 JSON 参数，如:\n{"input": "参数1"}\n{"input": "参数2"}\n{"input": "参数3"}'
                        style="width:100%;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;font-family:var(--font-mono);resize:vertical;"></textarea>
            </div>
            <div style="display:flex;gap:8px;margin-top:8px;">
              <button class="btn btn-sm btn-secondary" id="run-batch-upload">上传 JSON 文件</button>
              <div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;">
                或手动输入每行一组参数
              </div>
            </div>
            <input type="file" id="run-batch-file" accept=".json" style="display:none;">
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="run-workflow-confirm">运行</button>
      `,
    });

    // Toggle batch mode
    document.getElementById('run-batch-mode')?.addEventListener('change', (e) => {
      const singleEl = document.getElementById('run-single-params');
      const batchEl = document.getElementById('run-batch-params');
      if (singleEl) singleEl.style.display = e.target.checked ? 'none' : 'block';
      if (batchEl) batchEl.style.display = e.target.checked ? 'block' : 'none';
    });

    // Upload JSON file for batch
    document.getElementById('run-batch-upload')?.addEventListener('click', () => {
      document.getElementById('run-batch-file')?.click();
    });

    document.getElementById('run-batch-file')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const textarea = document.getElementById('run-batch-input');
        if (textarea) textarea.value = ev.target.result;
      };
      reader.readAsText(file);
    });

    document.getElementById('run-workflow-confirm').addEventListener('click', async () => {
      const runBtn = document.getElementById('run-workflow-confirm');
      const isBatch = document.getElementById('run-batch-mode')?.checked;

      if (isBatch) {
        // Batch mode
        const batchText = document.getElementById('run-batch-input')?.value.trim();
        if (!batchText) {
          Toast.error('请输入批量参数');
          return;
        }

        const lines = batchText.split('\n').map(l => l.trim()).filter(l => l);
        const paramsArray = [];
        for (let i = 0; i < lines.length; i++) {
          try {
            paramsArray.push(JSON.parse(lines[i]));
          } catch (e) {
            Toast.error(`第 ${i + 1} 行 JSON 格式错误`);
            return;
          }
        }

        if (runBtn) { runBtn.disabled = true; runBtn.textContent = '执行中...'; }
        Modal.close();

        try {
          const res = await API.batchExecuteWorkflow(id, paramsArray);
          Toast.success(`批量执行已开始，共 ${paramsArray.length} 组参数`);
          currentWorkflow.executionStatus = 'running';
          viewMode = 'builder';
          await loadWorkflows();
          renderContent();
          startStatusPolling(id);
        } catch (e) {
          Toast.error(e.message);
        }
      } else {
        // Single mode
        const paramsText = document.getElementById('run-params-input')?.value.trim();
        let params = {};

        if (paramsText) {
          try {
            params = JSON.parse(paramsText);
          } catch (e) {
            Toast.error('参数格式错误，请输入有效的 JSON');
            return;
          }
        }

        // Collect per-node user inputs
        const nodeInputs = {};
        document.querySelectorAll('.run-node-input').forEach(textarea => {
          const nodeId = textarea.dataset.nodeId;
          const value = textarea.value.trim();
          if (nodeId && value) {
            nodeInputs[nodeId] = value;
          }
        });

        Modal.close();

        try {
          const res = await API.executeWorkflow(id, { params, nodeInputs });
          Toast.success('工作流已开始执行');
          currentWorkflow.executionStatus = 'running';
          if (res.data && res.data.runId) {
            currentWorkflow.currentRunId = res.data.runId;
          }
          viewMode = 'builder';
          await loadWorkflows();
          renderContent();
          startStatusPolling(id);
        } catch (e) {
          Toast.error(e.message);
        }
      }
    });
  }

  async function pauseWorkflow(id) {
    try {
      if (currentWorkflow.executionStatus === 'paused') {
        await API.resumeWorkflow(id);
        Toast.success('工作流已恢复执行');
        currentWorkflow.executionStatus = 'running';
      } else {
        await API.pauseWorkflow(id);
        Toast.success('工作流已暂停');
        currentWorkflow.executionStatus = 'paused';
      }
      refreshToolbar();
    } catch (e) {
      Toast.error(e.message);
    }
  }

  async function stopWorkflow(id) {
    try {
      await API.stopWorkflow(id);
      Toast.success('工作流已停止');
    } catch (e) {
      Toast.error('停止失败: ' + e.message);
    }
  }

  async function stepWorkflow(id) {
    if (!currentWorkflow) return;
    try {
      // Get the selected node ID, or null to let backend decide the next node
      const selectedId = WorkflowCanvas.getNodes().find(n => n.status === 'pending' || n.status === 'waiting')?.id || null;
      const res = await API.stepWorkflow(id, selectedId);
      Toast.success('单步执行完成');
      if (res.data) {
        executionData = res.data;
        WorkflowCanvas.setExecutionData(executionData);
        refreshToolbar();
      }
    } catch (e) {
      Toast.error('单步执行失败: ' + e.message);
    }
  }

  async function simulateWorkflow(id) {
    Modal.open({
      title: '模拟运行',
      body: `
        <div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">
            使用模拟数据运行工作流，不会调用真实的 Agent 执行。
          </div>
          <div class="form-group">
            <div class="form-label">模拟数据 (JSON)</div>
            <textarea id="simulate-mock-input" rows="8" placeholder='输入模拟数据，如:\n{"node1": {"output": "模拟输出"}, "node2": {"output": "测试结果"}}'
                      style="width:100%;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:12px;font-family:var(--font-mono);resize:vertical;"></textarea>
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="simulate-confirm">开始模拟</button>
      `,
    });

    document.getElementById('simulate-confirm')?.addEventListener('click', async () => {
      const mockText = document.getElementById('simulate-mock-input')?.value.trim();
      let mockData = {};
      if (mockText) {
        try {
          mockData = JSON.parse(mockText);
        } catch (e) {
          Toast.error('参数格式错误，请输入有效的 JSON');
          return;
        }
      }

      Modal.close();

      try {
        const res = await API.simulateWorkflow(id, mockData);
        Toast.success('模拟运行已开始');
        if (res.data) {
          executionData = res.data;
          WorkflowCanvas.setExecutionData(executionData);
          refreshToolbar();
        }
      } catch (e) {
        Toast.error('模拟运行失败: ' + e.message);
      }
    });
  }

  function getCurrentWorkflowId() {
    return currentWorkflow?.id || null;
  }

  async function deleteWorkflow(id) {
    const wf = workflows.find(w => w.id === id);
    if (!wf) return;

    // 运行中的工作流禁止删除
    if (wf.executionStatus === 'running' || wf.executionStatus === 'paused') {
      Toast.warning('该工作流正在运行中，请先停止后再删除');
      return;
    }

    if (!await Modal.confirm('删除工作流', '确定删除此工作流？', false)) return;
    const btn = document.querySelector(`.wf-delete[data-id="${id}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    try {
      await API.deleteWorkflow(id);
      Toast.success('工作流已删除');
      if (currentWorkflow?.id === id) {
        currentWorkflow = null;
        executionData = null;
        stopStatusPolling();
      }
      await loadWorkflows();
      renderContent();
    } catch (e) {
      Toast.error(e.message);
      if (btn) { btn.disabled = false; btn.innerHTML = Icon.svg('delete', 14); }
    }
  }

  function addNodeToWorkflow() {
    if (!currentWorkflow) {
      Toast.warning('请先选择一个工作流');
      return;
    }
    WorkflowCanvas.addNode();
  }

  // ── Folder Selection ──

  function selectWorkflowFolder() {
    if (!currentWorkflow) return;
    DirectoryBrowser.open({
      title: '选择工作文件夹',
      onConfirm: async (folderPath) => {
        try {
          await API.setWorkflowFolder(currentWorkflow.id, folderPath);
          currentWorkflow.folderPath = folderPath;
          Toast.success('工作文件夹已设置');
          const pathEl = document.getElementById('wf-folder-path');
          if (pathEl) pathEl.textContent = folderPath || '/';
        } catch (e) {
          Toast.error(e.message);
        }
      }
    });
  }

  // ── WebSocket Handlers ──

  function onWorkflowUpdate(payload) {
    // Multi-workspace filtering: skip events from other workspaces
    if (currentWorkspaceFilter && payload.workspaceId && payload.workspaceId !== currentWorkspaceFilter) return;

    const idx = workflows.findIndex(w => w.id === payload.workflowId);
    if (idx >= 0) {
      workflows[idx].status = payload.status;
      if (viewMode === 'list') renderContent();
    }
    // Update current workflow status if it matches
    if (currentWorkflow && currentWorkflow.id === payload.workflowId) {
      currentWorkflow.status = payload.status;
      if (payload.executionStatus) {
        currentWorkflow.executionStatus = payload.executionStatus;
      }
      // Re-render read-only view to reflect status changes
      if (viewMode === 'readonly') {
        renderContent();
      }
    }
  }

  function onNodeUpdate(payload) {
    // Multi-workspace filtering: skip events from other workspaces
    if (currentWorkspaceFilter && payload.workspaceId && payload.workspaceId !== currentWorkspaceFilter) return;

    if (!currentWorkflow || currentWorkflow.id !== payload.workflowId) return;

    if (viewMode === 'readonly') {
      // Update node in currentWorkflow and re-render read-only view
      const nodes = currentWorkflow.nodes || [];
      const node = nodes.find(n => n.id === payload.nodeId);
      if (node) {
        node.status = payload.status;
        if (payload.output !== undefined) node.output = payload.output;
      }
      renderReadOnlyNodes(currentWorkflow);
      renderReadOnlyEdges(currentWorkflow);
      // Update progress bar and status counts
      updateReadonlyProgress(currentWorkflow);
    } else {
      WorkflowCanvas.updateNodeStatus(payload.nodeId, payload.status, payload.output);
    }
  }

  async function onWorkspaceChanged() {
    // 如果有未保存的更改，提示用户
    if (_hasUnsavedChanges && viewMode === 'builder') {
      const choice = await new Promise(resolve => {
        Modal.open({
          title: '工作区已切换',
          body: '当前工作流有未保存的更改。切换工作区后将丢失这些更改。',
          footer: `
            <button class="btn btn-secondary" id="ws-change-cancel">取消</button>
            <button class="btn btn-primary" id="ws-change-confirm">确认切换</button>
          `
        });
        setTimeout(() => {
          document.getElementById('ws-change-cancel')?.addEventListener('click', () => resolve('cancel'));
          document.getElementById('ws-change-confirm')?.addEventListener('click', () => resolve('confirm'));
        }, 0);
      });
      if (choice === 'cancel') return;
      _hasUnsavedChanges = false;
    }
    // 重置状态，切换到列表视图
    currentWorkflow = null;
    currentWorkspaceFilter = null;
    viewMode = 'list';
    _isDraft = false;
    stopStatusPolling();
    await render();
  }

  // ── Helpers ──

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // ── Workflow Import/Export ──

  async function exportSelectedWorkflows() {
    if (_selectedIds.size === 0) {
      Toast.warning('请先选择工作流');
      return;
    }

    const ids = Array.from(_selectedIds);
    try {
      const res = await API.exportWorkflows(ids);
      const data = JSON.stringify(res.data, null, 2);

      // Download as file
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workflows-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      Toast.success(`已导出 ${ids.length} 个工作流`);
    } catch (e) {
      Toast.error('导出失败: ' + e.message);
    }
  }

  async function importWorkflowsFromFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.workflows || !Array.isArray(data.workflows)) {
          Toast.error('无效的工作流文件');
          return;
        }

        const confirmed = await new Promise(resolve => {
          Modal.open({
            title: '导入工作流',
            body: `
              <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:16px;">
                将导入 <strong>${data.workflows.length}</strong> 个工作流到当前工作区。
              </div>
            `,
            footer: `
              <button class="btn btn-secondary" id="import-cancel-btn">取消</button>
              <button class="btn btn-primary" id="import-confirm-btn">确认导入</button>
            `
          });

          document.getElementById('import-cancel-btn').addEventListener('click', () => {
            Modal.close();
            resolve(false);
          });
          document.getElementById('import-confirm-btn').addEventListener('click', () => {
            Modal.close();
            resolve(true);
          });
        });

        if (!confirmed) return;

        const res = await API.importWorkflows(data.workflows, false);
        Toast.success(`已导入 ${res.data.length} 个工作流`);
        await loadWorkflows();
        renderContent();
      } catch (e) {
        Toast.error('导入失败: ' + e.message);
      }
    };
    input.click();
  }

  // ── NL Workflow Creation ──

  async function createWorkflowFromNL() {
    Modal.open({
      title: 'AI 创建工作流',
      body: `
        <div class="form-group">
          <label class="form-label">描述你想要的工作流</label>
          <textarea class="textarea" id="nl-description" rows="4" placeholder="例如：先搜集Python核心特性，然后整理成技术文档，最后生成报告"></textarea>
        </div>
        <div style="margin-top:12px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="nl-create-all-ws"> 同时在所有工作区创建
          </label>
        </div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:8px;">
          AI 将解析你的描述并自动创建带有完整提示词的工作流节点（约需10-30秒）
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" id="nl-cancel-btn">取消</button>
        <button class="btn btn-primary" id="nl-create-btn">创建工作流</button>
      `
    });

    document.getElementById('nl-cancel-btn').addEventListener('click', () => Modal.close());
    document.getElementById('nl-create-btn').addEventListener('click', async () => {
      const description = document.getElementById('nl-description')?.value.trim();
      if (!description) {
        Toast.warning('请输入描述');
        return;
      }

      const createAll = document.getElementById('nl-create-all-ws')?.checked || false;
      const btn = document.getElementById('nl-create-btn');
      btn.disabled = true;
      btn.textContent = 'AI 正在生成...';

      try {
        const res = await API.createWorkflowFromText(description);
        if (createAll && res.data) {
          // AI 创建成功后，克隆到所有工作区
          await API.batchCloneWorkflows([res.data.id], await getAllWorkspaceIdsExceptCurrent());
          Toast.success('工作流已在所有工作区创建');
        } else {
          Toast.success('工作流已创建');
        }
        Modal.close();
        currentWorkflow = res.data;
        viewMode = 'builder';
        await loadWorkflows();
        renderContent();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = '创建工作流';
        Toast.error('创建失败: ' + e.message);
      }
    });
  }

  async function getAllWorkspaceIdsExceptCurrent() {
    try {
      const info = await API.getWorkspaceInfo();
      const workspaces = await API.getWorkspaces();
      const currentPath = info?.data?.path || '';
      return (workspaces.data || [])
        .filter(ws => ws.path !== currentPath)
        .map(ws => ws.id);
    } catch (e) { return []; }
  }

  // ── Batch Selection ──────────────────────────────────────────

  function toggleSelectionMode() {
    _selectionMode = !_selectionMode;
    if (!_selectionMode) {
      _selectedIds.clear();
      removeBatchActionBar();
    }
    renderContent();
  }

  function toggleSelectItem(id) {
    if (_selectedIds.has(id)) {
      _selectedIds.delete(id);
    } else {
      _selectedIds.add(id);
    }
    updateBatchActionBar();
    document.querySelectorAll('.batch-checkbox').forEach(cb => {
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
      <button class="btn btn-sm btn-secondary" id="wf-batch-clone-btn">批量克隆</button>
      <button class="btn btn-sm btn-danger" id="batch-delete-btn">批量删除</button>
      <button class="btn btn-sm btn-secondary" id="batch-cancel-btn">取消选择</button>
    `;
    document.body.appendChild(bar);
    document.getElementById('wf-batch-clone-btn').addEventListener('click', batchClone);
    document.getElementById('batch-delete-btn').addEventListener('click', batchDelete);
    document.getElementById('batch-cancel-btn').addEventListener('click', () => { _selectionMode = false; _selectedIds.clear(); removeBatchActionBar(); renderContent(); });
    document.getElementById('batch-select-all')?.addEventListener('change', (e) => {
      const allCbs = document.querySelectorAll('.batch-checkbox');
      allCbs.forEach(cb => { cb.checked = e.target.checked; });
      if (e.target.checked) {
        getFilteredWorkflows().forEach(wf => _selectedIds.add(wf.id));
      } else {
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
    if (countEl) countEl.textContent = _selectedIds.size;
    if (_selectedIds.size > 0 && !document.getElementById('batch-action-bar')) {
      showBatchActionBar();
    } else if (_selectedIds.size === 0) {
      removeBatchActionBar();
    }
  }

  async function batchExecute() {
    if (_selectedIds.size === 0) {
      Toast.warning('请先选择工作流');
      return;
    }

    const ids = Array.from(_selectedIds);
    if (!confirm(`确定执行选中的 ${ids.length} 个工作流？`)) return;

    try {
      const res = await API.batchExecuteWorkflows(ids);
      const results = res.data || [];
      const success = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      Toast.success(`批量执行完成: ${success} 成功, ${failed} 失败`);
      _selectionMode = false;
      _selectedIds.clear();
      removeBatchActionBar();
      await loadWorkflows();
      renderContent();
    } catch (e) {
      Toast.error('批量执行失败: ' + e.message);
    }
  }

  async function batchDelete() {
    if (_selectedIds.size === 0) return;

    // 检查是否有运行中的工作流
    const selectedWfs = workflows.filter(w => _selectedIds.has(w.id));
    const runningWfs = selectedWfs.filter(w => w.executionStatus === 'running' || w.executionStatus === 'paused');
    if (runningWfs.length > 0) {
      Toast.warning(`${runningWfs.length} 个工作流正在运行中，请先停止后再删除`);
      return;
    }

    const msg = `确定删除选中的 ${_selectedIds.size} 个工作流？此操作不可撤销。`;

    if (!await Modal.confirm('批量删除', msg, false)) return;

    const ids = Array.from(_selectedIds);
    try {
      await API.deleteWorkflowsBatch(ids);
      Toast.success(`已删除 ${ids.length} 个工作流`);
      _selectionMode = false;
      _selectedIds.clear();
      removeBatchActionBar();
      if (currentWorkflow && ids.includes(currentWorkflow.id)) {
        currentWorkflow = null;
        executionData = null;
        stopStatusPolling();
      }
      await loadWorkflows();
      renderContent();
    } catch (e) {
      Toast.error('批量删除失败: ' + e.message);
    }
  }

  async function batchClone() {
    if (_selectedIds.size === 0) return;

    const selectedWfs = workflows.filter(w => _selectedIds.has(w.id));
    const cloneable = selectedWfs;

    // Get all active workspaces (excluding the source workspace)
    let activeWorkspaces = [];
    try {
      const res = await API.getWorkspaces();
      activeWorkspaces = res.data || [];
    } catch (e) {
      Toast.error('获取工作区列表失败');
      return;
    }

    // Filter out the workspaces that the selected workflows already belong to
    const sourceWsIds = new Set(cloneable.map(w => w.workspaceId));

    Modal.open({
      title: '批量克隆到工作区',
      body: `
        <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:12px;">
          将选中的工作流克隆到目标工作区（克隆不带执行记忆）
        </div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:8px;">
          待克隆: ${cloneable.length} 个工作流 → 选择目标工作区:
        </div>
        <div id="clone-target-workspaces" style="display:flex;flex-direction:column;gap:8px;max-height:240px;overflow-y:auto;">
          ${activeWorkspaces.map(ws => {
            const isSource = sourceWsIds.has(ws.id);
            return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;padding:6px 8px;border-radius:6px;background:${isSource ? 'var(--bg-deep)' : 'var(--bg-subtle)'};border:1px solid ${isSource ? 'var(--border-subtle)' : 'var(--border-subtle)'};${isSource ? 'opacity:0.5;pointer-events:none;' : ''}">
              <input type="checkbox" name="clone-target-ws" value="${ws.id}" style="accent-color:var(--accent-cyan);" ${isSource ? 'disabled' : ''}>
              <span style="color:var(--text-primary);">${escapeHtml(ws.name)}</span>
              <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary);margin-left:4px;">${escapeHtml(ws.path?.split(/[\\/]/).pop() || ws.path)}</span>
              ${isSource ? '<span style="font-size:10px;color:var(--text-tertiary);">（源工作区）</span>' : ''}
            </label>`;
          }).join('')}
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" id="clone-cancel-btn">取消</button>
        <button class="btn btn-primary" id="clone-confirm-btn">确认克隆</button>
      `
    });

    document.getElementById('clone-cancel-btn').addEventListener('click', () => Modal.close());
    document.getElementById('clone-confirm-btn').addEventListener('click', async () => {
      const targetChecks = document.querySelectorAll('input[name="clone-target-ws"]:checked');
      const targetIds = Array.from(targetChecks).map(cb => cb.value);

      if (targetIds.length === 0) {
        Toast.warning('请选择至少一个目标工作区');
        return;
      }

      if (cloneable.length === 0) {
        Toast.warning('没有可克隆的工作流');
        Modal.close();
        return;
      }

      const btn = document.getElementById('clone-confirm-btn');
      btn.disabled = true;
      btn.textContent = '克隆中...';

      try {
        const res = await API.batchCloneWorkflows(cloneable.map(w => w.id), targetIds);
        const result = res.data;
        Modal.close();

        if (result.cloned.length > 0) {
          Toast.success(`成功克隆 ${result.cloned.length} 个工作流`);
        }
        if (result.skipped.length > 0) {
          Toast.info(`跳过 ${result.skipped.length} 项: ${result.skipped.map(s => s.reason).join(', ')}`);
        }
        if (result.failed.length > 0) {
          Toast.warning(`${result.failed.length} 项克隆失败`);
        }

        _selectionMode = false;
        _selectedIds.clear();
        removeBatchActionBar();
        await loadWorkflows();
        renderContent();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = '确认克隆';
        Toast.error('克隆失败: ' + e.message);
      }
    });
  }

  // ── Read-Only View (Task 5) ──────────────────────────────────

  function viewWorkflowStatus(id) {
    viewMode = 'readonly';
    currentWorkflow = workflows.find(w => w.id === id) || null;
    if (!currentWorkflow) {
      Toast.error('工作流未找到');
      return;
    }
    // Load full workflow data then render
    API.getWorkflow(id).then(res => {
      currentWorkflow = res.data;
      // If workflow shows as 'running' but has no active runId, reset stale status
      if (currentWorkflow.executionStatus === 'running' && !currentWorkflow.currentRunId) {
        currentWorkflow.executionStatus = 'idle';
        currentWorkflow.nodes = (currentWorkflow.nodes || []).map(n => {
          if (n.status === 'running') {
            return { ...n, status: 'pending', startedAt: null };
          }
          return n;
        });
        // Persist the reset
        API.updateWorkflow(id, {
          executionStatus: 'idle',
          nodes: currentWorkflow.nodes
        }).catch(() => {});
      }
      renderContent();
    }).catch(e => Toast.error('加载工作流失败'));
  }

  function renderReadOnlyView(container) {
    if (!currentWorkflow) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">未选择工作流</div>';
      return;
    }

    stopStatusPolling();

    const status = currentWorkflow.executionStatus || currentWorkflow.status || 'pending';
    const nodes = currentWorkflow.nodes || [];
    const workNodes = nodes.filter(n => n.type !== 'start' && n.type !== 'end');
    const completedCount = workNodes.filter(n => n.status === 'completed').length;
    const failedCount = workNodes.filter(n => n.status === 'failed').length;
    const runningCount = workNodes.filter(n => n.status === 'running').length;
    const progressPercent = workNodes.length > 0 ? Math.round((completedCount / workNodes.length) * 100) : 0;

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;flex:1;min-height:0;">
        <!-- Toolbar -->
        <div class="toolbar" style="flex-wrap:wrap;margin-bottom:8px;">
          <span style="font-size:14px;font-weight:600;color:var(--text-primary);">${escapeHtml(currentWorkflow.name)}</span>
          ${StatusBadge.render(status)}
          ${runningCount > 0 ? '<span class="running-indicator"></span>' : ''}
          <div style="flex:1;display:flex;align-items:center;gap:8px;">
            <div style="width:120px;height:6px;background:var(--bg-tertiary);border-radius:3px;overflow:hidden;">
              <div style="width:${progressPercent}%;height:100%;background:${failedCount > 0 ? 'var(--accent-red)' : 'var(--accent-green)'};border-radius:3px;transition:width 0.5s;"></div>
            </div>
            <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">${completedCount}/${workNodes.length} (${progressPercent}%)</span>
            ${failedCount > 0 ? `<span style="font-size:11px;color:var(--accent-red);">${failedCount} 失败</span>` : ''}
          </div>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-sm btn-secondary" id="ro-zoom-in" title="放大">+</button>
            <button class="btn btn-sm btn-secondary" id="ro-zoom-out" title="缩小">-</button>
            <button class="btn btn-sm btn-secondary" id="ro-zoom-reset" title="重置">1:1</button>
          </div>
          <button class="btn btn-sm btn-primary" id="ro-goto-edit">跳转到编辑</button>
          <button class="btn btn-sm btn-secondary" id="ro-back-list">返回列表</button>
        </div>
        <!-- Canvas -->
        <div style="flex:1;position:relative;">
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
                <filter id="ro-glow">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>
              <g id="ro-canvas-group" transform="translate(0,0) scale(1)">
                <g id="ro-edges-layer"></g>
                <g id="ro-nodes-layer"></g>
              </g>
            </svg>
            <div style="position:absolute;bottom:8px;right:8px;font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">
              ${nodes.length} 个节点 | 只读模式
            </div>
          </div>
          <!-- Detail panel placeholder -->
          <div id="ro-detail-panel"></div>
        </div>
      </div>
    `;

    // Render edges and nodes
    renderReadOnlyEdges(currentWorkflow);
    renderReadOnlyNodes(currentWorkflow);
    initReadOnlyCanvas(currentWorkflow);

    // Start polling if workflow is running or paused
    if (status === 'running' || status === 'paused') {
      startStatusPolling(currentWorkflow.id);
    }

    // Button events
    document.getElementById('ro-goto-edit')?.addEventListener('click', () => {
      viewMode = 'builder';
      renderContent();
    });
    document.getElementById('ro-back-list')?.addEventListener('click', () => {
      viewMode = 'list';
      currentWorkflow = null;
      renderContent();
    });
    document.getElementById('ro-zoom-in')?.addEventListener('click', () => readOnlyZoom(1.2));
    document.getElementById('ro-zoom-out')?.addEventListener('click', () => readOnlyZoom(0.8));
    document.getElementById('ro-zoom-reset')?.addEventListener('click', () => readOnlyZoomReset());
  }

  let _roZoom = 1;
  let _roPan = { x: 0, y: 0 };

  function readOnlyZoom(factor) {
    _roZoom = Math.max(0.3, Math.min(3, _roZoom * factor));
    const g = document.getElementById('ro-canvas-group');
    if (g) g.setAttribute('transform', `translate(${_roPan.x},${_roPan.y}) scale(${_roZoom})`);
  }

  function readOnlyZoomReset() {
    _roZoom = 1;
    _roPan = { x: 0, y: 0 };
    const g = document.getElementById('ro-canvas-group');
    if (g) g.setAttribute('transform', `translate(0,0) scale(1)`);
  }

  function initReadOnlyCanvas(workflow) {
    const container = document.getElementById('ro-canvas-container');
    if (!container) return;
    let isPanning = false;
    let panStart = { x: 0, y: 0 };

    // Clean up previous listeners before adding new ones
    cleanupReadOnlyListeners(container);

    _roMouseDown = (e) => {
      const svgEl = document.getElementById('ro-svg');
      if (e.target === svgEl || e.target === container || e.target.tagName === 'svg') {
        isPanning = true;
        panStart = { x: e.clientX - _roPan.x, y: e.clientY - _roPan.y };
        container.style.cursor = 'grabbing';
      }
    };
    _roMouseMove = (e) => {
      if (isPanning) {
        _roPan = { x: e.clientX - panStart.x, y: e.clientY - panStart.y };
        const g = document.getElementById('ro-canvas-group');
        if (g) g.setAttribute('transform', `translate(${_roPan.x},${_roPan.y}) scale(${_roZoom})`);
      }
    };
    _roMouseUp = () => {
      isPanning = false;
      container.style.cursor = 'grab';
    };
    _roWheel = (e) => {
      e.preventDefault();
      readOnlyZoom(e.deltaY > 0 ? 0.9 : 1.1);
    };

    container.addEventListener('mousedown', _roMouseDown);
    window.addEventListener('mousemove', _roMouseMove);
    window.addEventListener('mouseup', _roMouseUp);
    container.addEventListener('wheel', _roWheel);
  }

  function cleanupReadOnlyListeners(container) {
    if (_roMouseDown && container) {
      container.removeEventListener('mousedown', _roMouseDown);
      _roMouseDown = null;
    }
    if (_roMouseMove) {
      window.removeEventListener('mousemove', _roMouseMove);
      _roMouseMove = null;
    }
    if (_roMouseUp) {
      window.removeEventListener('mouseup', _roMouseUp);
      _roMouseUp = null;
    }
    if (_roWheel && container) {
      container.removeEventListener('wheel', _roWheel);
      _roWheel = null;
    }
  }

  function updateReadonlyProgress(workflow) {
    const nodes = workflow.nodes || [];
    const workNodes = nodes.filter(n => n.type !== 'start' && n.type !== 'end');
    const status = workflow.executionStatus || workflow.status || 'pending';
    const completedCount = workNodes.filter(n => n.status === 'completed').length;
    const failedCount = workNodes.filter(n => n.status === 'failed').length;
    const runningCount = workNodes.filter(n => n.status === 'running').length;
    const progressPercent = workNodes.length > 0 ? Math.round((completedCount / workNodes.length) * 100) : 0;

    // Update progress bar
    const progressBar = document.querySelector('#ro-canvas-container')?.parentElement?.previousElementSibling;
    if (progressBar) {
      const barFill = progressBar.querySelector('div[style*="width:"]');
      if (barFill) barFill.style.width = progressPercent + '%';
      if (barFill) barFill.style.background = failedCount > 0 ? 'var(--accent-red)' : 'var(--accent-green)';
    }

    // Update progress text
    const progressText = progressBar?.querySelector('span[style*="font-mono"]');
    if (progressText) progressText.textContent = `${completedCount}/${workNodes.length} (${progressPercent}%)`;

    // Update status badge
    const badgeContainer = progressBar?.querySelector('.status-badge, [class*="badge"]');
    // Re-render the whole toolbar area by updating status-related elements
    const toolbar = document.querySelector('#ro-canvas-container')?.closest('[style*="flex-direction:column"]')?.querySelector('[style*="padding:10px 16px"]');
    if (toolbar) {
      // Update running indicator
      const existingIndicator = toolbar.querySelector('.running-indicator');
      if (runningCount > 0 && !existingIndicator) {
        const indicator = document.createElement('span');
        indicator.className = 'running-indicator';
        toolbar.insertBefore(indicator, toolbar.children[2]);
      } else if (runningCount === 0 && existingIndicator) {
        existingIndicator.remove();
      }

      // Update failed count text
      const failedSpan = toolbar.querySelector('span[style*="accent-red"]');
      if (failedCount > 0 && !failedSpan) {
        const span = document.createElement('span');
        span.style.cssText = 'font-size:11px;color:var(--accent-red);';
        span.textContent = `${failedCount} 失败`;
        toolbar.querySelector('[style*="flex:1"]')?.appendChild(span);
      } else if (failedSpan) {
        failedSpan.textContent = `${failedCount} 失败`;
        failedSpan.style.display = failedCount > 0 ? '' : 'none';
      }
    }
  }

  function renderReadOnlyNodes(workflow) {
    const layer = document.getElementById('ro-nodes-layer');
    if (!layer) return;
    const NODE_W = 200, NODE_H = 80;
    const STATUS_CONFIG = { pending: { color: 'var(--text-muted)', text: '等待中' }, waiting: { color: 'var(--accent-amber)', text: '等待依赖' }, running: { color: 'var(--accent-cyan)', text: '运行中...' }, completed: { color: 'var(--accent-green)', text: '已完成' }, failed: { color: 'var(--accent-red)', text: '失败' }, skipped: { color: '#6b7280', text: '已跳过' } };
    const ROLE_ICONS = { start: 'S', end: 'E', agent: 'A', condition: '?', developer: '{}', reviewer: 'V', tester: 'T', planner: 'P', debugger: 'X', documenter: 'D', parallel: '⚡', timer: '⏱', code: '{}', subworkflow: '⧉', loop: '↻' };
    const ROLE_COLORS = { start: 'var(--accent-green)', end: 'var(--accent-red)', agent: 'var(--accent-cyan)', condition: 'var(--accent-amber)', developer: 'var(--accent-purple)', reviewer: 'var(--accent-amber)', tester: 'var(--accent-green)', planner: 'var(--accent-cyan)', debugger: 'var(--accent-red)', documenter: 'var(--accent-amber)', parallel: 'var(--accent-amber)', timer: 'var(--accent-cyan)', code: 'var(--accent-green)', subworkflow: '#8b5cf6', loop: '#f97316' };

    const nodes = workflow.nodes || [];
    layer.innerHTML = nodes.map(node => {
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
          <text x="20" y="43" text-anchor="middle" font-size="12" font-weight="700" fill="${roleColor}" font-family="var(--font-mono)">${roEscapeXml(roleIcon)}</text>
          <text x="42" y="32" font-size="12" font-weight="600" fill="var(--text-primary)" font-family="var(--font-sans)">${roEscapeXml(roTruncate(node.label || nodeType, 14))}</text>
          <text x="42" y="48" font-size="10" fill="${statusCfg.color}" font-family="var(--font-mono)">${statusCfg.text}</text>
          <text x="12" y="66" font-size="9" fill="var(--text-muted)" font-family="var(--font-sans)">${roEscapeXml(roTruncate(node.output || '', 28))}</text>
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
      el.addEventListener('click', (e) => {
        if (e.target.closest('.port-in') || e.target.closest('.port-out')) return;
        showReadOnlyNodeDetail(el.dataset.id, workflow);
      });
    });
  }

  function renderReadOnlyEdges(workflow) {
    const layer = document.getElementById('ro-edges-layer');
    if (!layer) return;
    const NODE_W = 200, NODE_H = 80;
    const nodes = workflow.nodes || [];
    const edges = workflow.edges || [];

    layer.innerHTML = edges.map(edge => {
      const src = nodes.find(n => n.id === edge.source);
      const tgt = nodes.find(n => n.id === edge.target);
      if (!src || !tgt) return '';

      const sx = (src.position?.x || 0) + NODE_W;
      const sy = (src.position?.y || 0) + NODE_H / 2;
      const tx = tgt.position?.x || 0;
      const ty = (tgt.position?.y || 0) + NODE_H / 2;
      const dx = Math.abs(tx - sx);
      const cpDist = Math.max(40, dx * 0.35);
      const bend = edge?.bendOffset || 0;
      const d = `M${sx},${sy} C${sx + cpDist},${sy + bend} ${tx - cpDist},${ty + bend} ${tx},${ty}`;

      const edgeStatus = (src.status === 'running' || tgt.status === 'running') ? 'running' :
                         (src.status === 'completed' && tgt.status === 'completed') ? 'completed' :
                         (src.status === 'failed' || tgt.status === 'failed') ? 'failed' : '';
      const strokeColor = edgeStatus === 'running' ? 'var(--accent-cyan)' : edgeStatus === 'completed' ? 'var(--accent-green)' : edgeStatus === 'failed' ? 'var(--accent-red)' : 'var(--accent-cyan-dim)';
      const markerId = edgeStatus ? `ro-arrowhead-${edgeStatus}` : 'ro-arrowhead';
      const dashAttr = edgeStatus === 'running' ? 'stroke-dasharray="8 4"' : '';

      const t = 0.5;
      const mx = (1-t)*(1-t)*(1-t)*sx + 3*(1-t)*(1-t)*t*(sx+cpDist) + 3*(1-t)*t*t*(tx-cpDist) + t*t*t*tx;
      const my = (1-t)*(1-t)*(1-t)*sy + 3*(1-t)*(1-t)*t*(sy+bend) + 3*(1-t)*t*t*(ty+bend) + t*t*t*ty;

      return `
        <g class="wf-edge ${edgeStatus}">
          <path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="2" marker-end="url(#${markerId})" opacity="0.8" ${dashAttr}/>
          ${edge.label ? `
            <g class="edge-label" transform="translate(${mx},${my - 8})">
              <rect x="-4" y="-11" width="${edge.label.length * 7 + 8}" height="15" rx="3" fill="var(--bg-secondary)" stroke="var(--border-subtle)" stroke-width="0.5" opacity="0.9" transform="translate(-${(edge.label.length * 7 + 8) / 2}, 0)"/>
              <text text-anchor="middle" dy="-1" fill="var(--text-secondary)" font-size="10" font-family="var(--font-mono)">${roEscapeXml(edge.label)}</text>
            </g>
          ` : ''}
        </g>
      `;
    }).join('');
  }

  function showReadOnlyNodeDetail(nodeId, workflow) {
    const node = (workflow.nodes || []).find(n => n.id === nodeId);
    if (!node) return;

    const STATUS_CONFIG = { pending: { color: 'var(--text-muted)', text: '等待中' }, waiting: { color: 'var(--accent-amber)', text: '等待依赖' }, running: { color: 'var(--accent-cyan)', text: '运行中...' }, completed: { color: 'var(--accent-green)', text: '已完成' }, failed: { color: 'var(--accent-red)', text: '失败' }, skipped: { color: '#6b7280', text: '已跳过' } };
    const status = node.status || 'pending';
    const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;

    let panel = document.getElementById('ro-detail-panel');
    if (!panel) return;
    panel.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:320px;background:var(--bg-secondary);border-left:1px solid var(--border-subtle);overflow-y:auto;z-index:50;border-radius:0 var(--border-radius-lg) var(--border-radius-lg) 0;';

    panel.innerHTML = `
      <div style="padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="font-size:14px;font-weight:600;margin:0;">${roEscapeXml(node.label)}</h3>
          <button class="btn btn-sm btn-ghost" id="ro-close-detail" style="font-size:16px;line-height:1;">${Icon.svg('close', 16)}</button>
        </div>
        <div class="form-group">
          <div class="form-label">状态</div>
          <span class="badge badge-${status}">${statusCfg.text}</span>
        </div>
        <div class="form-group">
          <div class="form-label">类型</div>
          <span style="font-size:12px;color:var(--text-secondary);">${roEscapeXml(node.type || 'agent')}</span>
        </div>
        ${node.agentId ? `<div class="form-group"><div class="form-label">Agent ID</div><div style="font-family:var(--font-mono);font-size:11px;">${roEscapeXml(node.agentId)}</div></div>` : ''}
        ${node.startedAt ? `<div class="form-group"><div class="form-label">开始时间</div><div style="font-size:12px;">${new Date(node.startedAt).toLocaleString()}</div></div>` : ''}
        ${node.completedAt ? `<div class="form-group"><div class="form-label">完成时间</div><div style="font-size:12px;">${new Date(node.completedAt).toLocaleString()}</div></div>` : ''}
        ${node.output ? `<div class="form-group"><div class="form-label">输出</div><div style="background:var(--bg-deep);padding:8px;border-radius:4px;font-size:12px;font-family:var(--font-mono);word-break:break-word;max-height:200px;overflow-y:auto;">${roEscapeXml(node.output)}</div></div>` : ''}
        ${(node.logs && node.logs.length > 0) ? `<div class="form-group"><div class="form-label">日志 (${node.logs.length})</div><div class="log-viewer" style="max-height:200px;">${node.logs.map(log => `<div class="log-entry"><span class="log-timestamp">${new Date(log.timestamp).toLocaleTimeString()}</span><span class="log-level ${log.level}">${log.level}</span><span class="log-message">${roEscapeXml(log.message)}</span></div>`).join('')}</div></div>` : ''}
      </div>
    `;

    document.getElementById('ro-close-detail')?.addEventListener('click', () => {
      panel.innerHTML = '';
      panel.style.cssText = '';
    });
  }

  function roEscapeXml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function roTruncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '...' : str;
  }

  function _onReconnect() {
    console.log('[WorkflowsPage] WebSocket reconnected, refreshing data...');
    loadWorkflows().then(() => renderContent());
  }

  function cleanup() {
    _wsUnsubs.forEach(fn => fn());
    _wsUnsubs = [];
    window.removeEventListener('ws:reconnected', _onReconnect);
    cleanupReadOnlyListeners(document.getElementById('ro-canvas-container'));
    stopStatusPolling();
    WorkflowCanvas.cleanup();
    _selectionMode = false;
    _selectedIds.clear();
    _isDraft = false;
    removeBatchActionBar();
  }

  return { render, cleanup, getCurrentWorkflowId, viewWorkflowStatus };
})();
