"use strict";
window.FilesPage = (() => {
    let currentPath = '';
    let currentContent = '';
    let _dirty = false;
    let _beforeUnloadHandler = null;
    let _workspacesExpanded = true;
    let _workspaces = [];
    // ── Undo / Redo state ──
    let _undoHistory = [];
    let _undoIndex = -1;
    let _undoDebounceTimer = null;
    let _undoCacheSaveTimer = null;
    const UNDO_MAX = 50;
    let _currentDirPath = ''; // tracks the directory being previewed (for back navigation)
    let _isReadOnlyFile = false; // true when viewing image or binary
    // ── Diff view state ──
    let _diffViewActive = false;
    let _diffSplitMode = true;
    // ── Markdown preview state ──
    let _mdMode = 'edit'; // 'edit' | 'preview' | 'split'
    async function render() {
        const el = document.getElementById('content');
        el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">▤</span> 文件</h1>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-secondary" id="new-workspace-btn">+ 工作区</button>
            <button class="btn btn-secondary" id="new-file-btn">+ 文件</button>
            <button class="btn btn-secondary" id="new-folder-btn">+ 文件夹</button>
            <button class="btn btn-secondary" id="import-file-btn">导入文件</button>
          </div>
        </div>
        <div id="workspace-indicator" style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;margin-bottom:12px;background:var(--bg-subtle);border:1px solid var(--border-subtle);border-radius:var(--border-radius-md);">
          <span id="workspace-path-display" style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-right:12px;">加载中...</span>
          <button class="btn btn-sm btn-secondary" id="switch-workspace-btn">切换工作区</button>
        </div>
        <div id="ws-mgmt-toggle" style="display:flex;align-items:center;padding:8px 16px;margin-bottom:12px;background:var(--bg-subtle);border:1px solid var(--border-subtle);border-radius:var(--border-radius-md);cursor:pointer;user-select:none;transition:background 0.15s;">
          <span id="ws-mgmt-arrow" style="margin-right:8px;font-size:14px;font-weight:bold;color:var(--accent-cyan);transition:transform 0.2s;display:inline-block;${_workspacesExpanded ? 'transform:rotate(90deg);' : ''}">▶</span>
          <span style="font-size:13px;font-weight:600;">工作区管理</span>
          <span id="ws-mgmt-count" style="margin-left:8px;font-size:12px;color:var(--text-muted);">加载中...</span>
        </div>
        <div id="ws-mgmt-panel" style="display:${_workspacesExpanded ? 'block' : 'none'};margin-bottom:16px;">
          <div id="ws-mgmt-actions" style="display:flex;justify-content:flex-end;margin-bottom:12px;">
            <button class="btn btn-sm btn-primary" id="ws-activate-new-btn">+ 激活新工作区</button>
          </div>
          <div id="ws-mgmt-grid"></div>
        </div>
        <div id="file-panel-container" style="display:flex;gap:0;flex:1;min-height:0;">
          <div id="file-tree-wrapper" style="width:280px;flex-shrink:0;overflow-y:auto;">
            <div class="card" style="height:100%;overflow-y:auto;">
              <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;">
                <h3 class="card-title" style="font-size:13px;">文件树</h3>
                <button class="btn btn-sm btn-ghost" id="file-tree-refresh-btn" title="刷新文件树" style="font-size:11px;">↻</button>
              </div>
              <div id="file-tree"></div>
            </div>
          </div>
          <div id="file-tree-drag-handle" style="width:4px;cursor:col-resize;flex-shrink:0;background:var(--border-subtle);transition:background 0.15s;margin:0 4px;border-radius:2px;"></div>
          <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
            <div id="file-editor-header" style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;">
              <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
                <button class="btn btn-sm btn-secondary" id="back-btn" style="display:none;flex-shrink:0;" title="返回上级目录">← 返回上级</button>
                <span id="file-path-display" style="font-family:var(--font-mono);font-size:12px;color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">请选择要查看的文件</span>
              </div>
              <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                <button class="btn btn-sm btn-secondary" id="diff-view-btn" style="display:none;" title="查看差异">查看差异</button>
                <button class="btn btn-sm btn-secondary" id="md-edit-btn" style="display:none;" title="编辑模式">编辑</button>
                <button class="btn btn-sm btn-secondary" id="md-preview-btn" style="display:none;" title="预览模式">预览</button>
                <button class="btn btn-sm btn-secondary" id="md-split-btn" style="display:none;" title="分屏模式">分屏</button>
                <button class="btn btn-sm btn-secondary" id="undo-btn" style="display:none;" title="撤销 (Ctrl+Z)">↩ 撤销</button>
                <button class="btn btn-sm btn-secondary" id="redo-btn" style="display:none;" title="重做 (Ctrl+Y)">↪ 重做</button>
                <button class="btn btn-sm btn-primary" id="save-file-btn" style="display:none;">保存</button>
              </div>
            </div>
            <div id="file-editor" style="flex:1;background:var(--bg-deep);border:1px solid var(--border-subtle);border-radius:var(--border-radius-lg);overflow:hidden;">
              <div class="empty-state" style="height:100%;">
                <div class="empty-icon">▤</div>
                <div class="empty-title">未选择文件</div>
                <div class="empty-desc">点击文件树中的文件查看其内容</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
        document.getElementById('new-workspace-btn').addEventListener('click', createWorkspace);
        document.getElementById('new-file-btn').addEventListener('click', createFile);
        document.getElementById('new-folder-btn').addEventListener('click', createFolder);
        document.getElementById('save-file-btn').addEventListener('click', saveFile);
        document.getElementById('switch-workspace-btn').addEventListener('click', switchWorkspace);
        document.getElementById('import-file-btn').addEventListener('click', openImportDialog);
        document.getElementById('back-btn').addEventListener('click', navigateBack);
        document.getElementById('undo-btn').addEventListener('click', performUndo);
        document.getElementById('redo-btn').addEventListener('click', performRedo);
        document.getElementById('diff-view-btn').addEventListener('click', toggleDiffView);
        document.getElementById('md-edit-btn').addEventListener('click', () => switchMdMode('edit'));
        document.getElementById('md-preview-btn').addEventListener('click', () => switchMdMode('preview'));
        document.getElementById('md-split-btn').addEventListener('click', () => switchMdMode('split'));
        // File tree resize drag handle
        const treeHandle = document.getElementById('file-tree-drag-handle');
        const treeWrapper = document.getElementById('file-tree-wrapper');
        if (treeHandle && treeWrapper) {
            let _dragStart = 0;
            let _startWidth = 280;
            treeHandle.addEventListener('mousedown', (e) => {
                _dragStart = e.clientX;
                _startWidth = treeWrapper.offsetWidth;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                const onDrag = (ev) => {
                    const diff = ev.clientX - _dragStart;
                    treeWrapper.style.width = Math.max(140, Math.min(600, _startWidth + diff)) + 'px';
                };
                const onDragEnd = () => {
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    document.removeEventListener('mousemove', onDrag);
                    document.removeEventListener('mouseup', onDragEnd);
                };
                document.addEventListener('mousemove', onDrag);
                document.addEventListener('mouseup', onDragEnd);
            });
            treeHandle.addEventListener('mouseenter', () => { treeHandle.style.background = 'var(--accent-cyan)'; });
            treeHandle.addEventListener('mouseleave', () => { treeHandle.style.background = 'var(--border-subtle)'; });
        }
        // File tree refresh button
        document.getElementById('file-tree-refresh-btn').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.setAttribute('disabled', 'true');
            btn.style.transform = 'rotate(360deg)';
            btn.style.transition = 'transform 0.4s ease';
            try {
                await loadTree();
                Toast.success('文件树已刷新');
            }
            catch (_) {
                Toast.error('刷新失败');
            }
            finally {
                setTimeout(() => {
                    btn.style.transform = '';
                    btn.style.transition = '';
                    btn.removeAttribute('disabled');
                }, 400);
            }
        });
        // Workspace management toggle
        document.getElementById('ws-mgmt-toggle').addEventListener('click', toggleWorkspacePanel);
        document.getElementById('ws-activate-new-btn').addEventListener('click', activateNewWorkspace);
        // Dirty-checking: warn before leaving with unsaved changes
        _beforeUnloadHandler = (e) => {
            if (_dirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', _beforeUnloadHandler);
        await loadWorkspaceInfo();
        await loadTree();
        await loadWorkspacesList();
        // 监听工作区切换事件，自动刷新工作区列表和文件树
        if (typeof WS !== 'undefined' && WS.on) {
            WS.on('workspace.changed', () => {
                loadWorkspaceInfo();
                loadTree();
                loadWorkspacesList();
            });
        }
    }
    // ── Workspace Management (merged from WorkspacesPage) ──
    function toggleWorkspacePanel() {
        _workspacesExpanded = !_workspacesExpanded;
        const panel = document.getElementById('ws-mgmt-panel');
        const arrow = document.getElementById('ws-mgmt-arrow');
        if (panel)
            panel.style.display = _workspacesExpanded ? 'block' : 'none';
        if (arrow) {
            arrow.style.transform = _workspacesExpanded ? 'rotate(90deg)' : '';
            arrow.style.color = _workspacesExpanded ? 'var(--accent-cyan)' : 'var(--text-muted)';
        }
    }
    async function loadWorkspacesList() {
        try {
            // 只获取活跃工作区
            const res = await API.getWorkspaces();
            const activeList = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
            _workspaces = activeList;
            if (typeof Store !== 'undefined')
                Store.set('activeWorkspaces', _workspaces);
            renderWorkspaceGrid(_workspaces);
        }
        catch (e) {
            renderWorkspaceGrid([]);
        }
    }
    function renderWorkspaceGrid(wsList) {
        const countEl = document.getElementById('ws-mgmt-count');
        if (countEl)
            countEl.textContent = `(${wsList.length} 个工作区)`;
        const container = document.getElementById('ws-mgmt-grid');
        if (!container)
            return;
        if (wsList.length === 0) {
            container.innerHTML = `
        <div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;background:var(--bg-subtle);border:1px solid var(--border-subtle);border-radius:var(--border-radius-md);">
          暂无活跃工作区。点击"激活新工作区"按钮选择一个目录作为工作区。
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
        container.querySelectorAll('.ws-switch-btn').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const wsPath = btn.dataset.path;
                try {
                    await API.setWorkspace(wsPath);
                    Toast.success('工作区已切换');
                    // 刷新文件树和工作区状态
                    loadTree();
                    loadWorkspacesList();
                    // 通知其他组件
                    if (typeof WS !== 'undefined' && WS.emit) {
                        WS.emit('workspace.changed', { path: wsPath });
                    }
                }
                catch (err) {
                    Toast.error(err.message || '切换失败');
                }
            });
        });
        container.querySelectorAll('.ws-view-workflows-btn').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const wsId = btn.dataset.wsId;
                const wsPath = btn.dataset.wsPath;
                // 先切换服务器端工作区
                if (wsPath) {
                    try {
                        await API.setWorkspace(wsPath);
                        // 等待顶部栏更新完成后再导航
                        if (typeof Navbar !== 'undefined' && Navbar.loadCurrentWorkspace) {
                            await Navbar.loadCurrentWorkspace();
                        }
                        if (typeof WS !== 'undefined' && WS.emit) {
                            WS.emit('workspace.changed', { path: wsPath });
                        }
                        // 刷新工作区列表以更新激活状态
                        loadWorkspacesList();
                    }
                    catch (err) {
                        Toast.error(err.message || '切换工作区失败');
                        return;
                    }
                }
                Store.set('activeWorkspaceId', wsId);
                Router.navigate('/workflows');
            });
        });
    }
    function renderWorkspaceCard(ws) {
        const isActive = !!ws.id; // 有 id 表示已在 WorkspaceManager 中激活
        const name = ws.name || ws.path.split(/[/\\]/).pop() || '未知工作区';
        const activatedTime = ws.activatedAt ? formatTime(ws.activatedAt) : '--';
        const workflowCount = ws.workflowCount === -1 ? '—' : String(ws.workflowCount || 0);
        const runningCount = ws.runningWorkflowCount || 0;
        const wsId = ws.id || ws.path; // 历史记录没有 id，用 path 代替
        return `
      <div class="card hover-lift" data-id="${escapeHtml(wsId)}" data-path="${escapeHtml(ws.path)}">
        <div class="card-header">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${isActive ? 'var(--accent-green)' : 'var(--text-muted)'};display:inline-block;flex-shrink:0;"></span>
            <div class="card-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}</div>
          </div>
          ${!isActive ? '<span class="badge" style="font-size:10px;background:var(--bg-surface);color:var(--text-secondary);">未激活</span>' : ''}
          ${runningCount > 0 ? `<span class="badge badge-running"><span class="dot"></span> ${runningCount} 运行中</span>` : ''}
        </div>
        <div class="card-body">
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary);margin-bottom:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(ws.path)}">
            ${escapeHtml(ws.path)}
          </div>
          ${isActive ? `
          <div style="display:flex;gap:16px;font-size:11px;color:var(--text-muted);margin-bottom:6px;">
            <span>${workflowCount} 个工作流</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);">
            激活于 ${activatedTime}
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;">
          <button class="btn btn-sm btn-primary ws-switch-btn" data-path="${escapeHtml(ws.path)}">切换到此处</button>
          <button class="btn btn-sm btn-secondary ws-view-workflows-btn" data-ws-id="${escapeHtml(wsId)}" data-ws-path="${escapeHtml(ws.path)}">进入工作区</button>
          <button class="btn btn-sm btn-danger ws-deactivate-btn" data-id="${escapeHtml(wsId)}">停用</button>
        </div>
      ` : `
        </div>
        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;">
          <button class="btn btn-sm btn-primary ws-switch-btn" data-path="${escapeHtml(ws.path)}">激活并切换到此处</button>
        </div>
      `}
      </div>
    `;
    }
    async function activateNewWorkspace() {
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
                    await loadWorkspacesList();
                    updateNavbarWorkspaceCount();
                }
                catch (e) {
                    Toast.error(e.message || '激活工作区失败');
                }
            },
        });
    }
    async function deactivateWorkspace(id) {
        if (!await Modal.confirm('停用工作区', '确定停用此工作区？停用后将从管理平台移除，工作区内的本地文件不会被删除，可随时重新激活。'))
            return;
        try {
            await API.deactivateWorkspace(id);
            Toast.success('工作区已停用');
            // Get current workspace info to check if we deactivated the current one
            let currentWsPath = '';
            try {
                const infoRes = await API.getWorkspaceInfo();
                currentWsPath = infoRes?.data?.path || '';
            }
            catch (_) { }
            const deactivatedWs = _workspaces.find((ws) => ws.id === id);
            await loadWorkspacesList();
            updateNavbarWorkspaceCount();
            // If the deactivated workspace was the current one
            if (deactivatedWs && deactivatedWs.path === currentWsPath) {
                if (_workspaces.length > 0) {
                    // 切换到其他工作区
                    const nextWs = _workspaces[0];
                    try {
                        const res = await API.setWorkspace(nextWs.path);
                        if (res?.data?.state && typeof Store !== 'undefined' && Store.setState) {
                            Store.setState(res.data.state);
                        }
                    }
                    catch (_) { }
                }
                // 刷新导航栏和文件树（无论是否有工作区）
                if (typeof Navbar !== 'undefined' && Navbar.loadCurrentWorkspace) {
                    Navbar.loadCurrentWorkspace();
                }
                await loadWorkspaceInfo();
                await loadTree();
            }
        }
        catch (e) {
            Toast.error(e.message || '停用工作区失败');
        }
    }
    function updateNavbarWorkspaceCount() {
        const el = document.getElementById('active-workspace-count');
        if (el)
            el.textContent = String(_workspaces.length);
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
    // ── File Tree ──
    async function loadTree() {
        try {
            const res = await API.listFiles('');
            const tree = document.getElementById('file-tree');
            if (!tree)
                return;
            if (Array.isArray(res.data) && res.data.length > 0) {
                tree.innerHTML = FileTree.render(res.data);
                FileTree.bind(tree, onFileSelect, handleContextMenu);
            }
            else {
                tree.innerHTML = '<div style="padding:12px;font-size:12px;color:var(--text-muted);">暂无文件。创建一个工作区以开始使用。</div>';
            }
        }
        catch (e) {
            Toast.error('加载文件失败');
        }
    }
    async function onFileSelect(path, type) {
        if (type === 'directory') {
            if (_dirty) {
                const confirmed = await Modal.confirm('未保存的更改', '文件已修改但未保存，确定离开吗？');
                if (!confirmed)
                    return;
                await saveUndoCacheToBackend();
                _dirty = false;
            }
            showDirectoryPreview(path);
            return;
        }
        // Unsaved changes check when switching files
        if (_dirty && path !== currentPath) {
            const confirmed = await Modal.confirm('未保存的更改', '文件已修改但未保存，确定离开吗？');
            if (!confirmed)
                return;
            await saveUndoCacheToBackend();
            _dirty = false;
        }
        currentPath = path;
        _isReadOnlyFile = false;
        try {
            const res = await API.readFile(path);
            currentContent = res.data?.content || '';
            const editor = document.getElementById('file-editor');
            const pathDisplay = document.getElementById('file-path-display');
            const saveBtn = document.getElementById('save-file-btn');
            const undoBtn = document.getElementById('undo-btn');
            const redoBtn = document.getElementById('redo-btn');
            const backBtn = document.getElementById('back-btn');
            if (pathDisplay)
                pathDisplay.textContent = path;
            if (backBtn)
                backBtn.style.display = '';
            // Determine file type by extension
            const ext = (path.split('.').pop() || '').toLowerCase();
            const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
            const binaryExts = ['exe', 'dll', 'so', 'bin', 'zip', 'tar', 'gz', 'rar', '7z', 'pdf', 'mp3', 'mp4', 'avi', 'wav', 'mov', 'wmv', 'flv', 'ttf', 'otf', 'woff', 'woff2'];
            if (editor) {
                if (imageExts.includes(ext)) {
                    _isReadOnlyFile = true;
                    const rawUrl = '/api/files/raw?path=' + encodeURIComponent(currentPath);
                    // Fetch image with API key and create blob URL
                    const key = localStorage.getItem('claude_console_api_key') || '';
                    fetch(rawUrl, { headers: { 'X-API-Key': key } }).then((r) => r.blob()).then((blob) => {
                        const blobUrl = URL.createObjectURL(blob);
                        const imgEl = editor.querySelector('img');
                        if (imgEl)
                            imgEl.src = blobUrl;
                    }).catch(() => { });
                    editor.innerHTML = `
            <div style="padding:20px;height:100%;overflow:auto;display:flex;align-items:center;justify-content:center;background:var(--bg-deep);">
              <img src=""
                   style="max-width:100%;max-height:100%;object-fit:contain;border-radius:var(--border-radius-md);box-shadow:0 2px 12px rgba(0,0,0,0.3);"
                   alt="${escapeHtml(currentPath)}"
                   onerror="this.parentElement.innerHTML='<div class=\\'empty-state\\'><div class=\\'empty-icon\\'>🖼️</div><div class=\\'empty-title\\'>图片加载失败</div></div>'">
            </div>
          `;
                    if (pathDisplay)
                        pathDisplay.textContent = currentPath;
                    if (saveBtn)
                        saveBtn.style.display = 'none';
                    if (undoBtn)
                        undoBtn.style.display = 'none';
                    if (redoBtn)
                        redoBtn.style.display = 'none';
                    // Show back button
                    const backBtn2 = document.getElementById('back-btn');
                    if (backBtn2)
                        backBtn2.style.display = '';
                    _undoHistory = [];
                    _undoIndex = -1;
                    return;
                }
                else if (ext === 'pdf') {
                    _isReadOnlyFile = true;
                    const rawUrl = '/api/files/raw?path=' + encodeURIComponent(currentPath);
                    // Fetch PDF with API key and create blob URL
                    const key = localStorage.getItem('claude_console_api_key') || '';
                    fetch(rawUrl, { headers: { 'X-API-Key': key } }).then((r) => r.blob()).then((blob) => {
                        const blobUrl = URL.createObjectURL(blob);
                        const iframe = editor.querySelector('iframe');
                        if (iframe)
                            iframe.src = blobUrl;
                        const link = editor.querySelector('.pdf-open-link');
                        if (link)
                            link.href = blobUrl;
                    }).catch(() => { });
                    editor.innerHTML = `
            <div style="height:100%;display:flex;flex-direction:column;background:var(--bg-deep);">
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;background:var(--bg-secondary);border-bottom:1px solid var(--border-color);flex-shrink:0;">
                <span style="font-size:13px;font-weight:600;color:var(--text-primary);">📕 PDF 文档</span>
                <a class="btn btn-sm btn-secondary pdf-open-link" style="text-decoration:none;">在新标签页中打开</a>
              </div>
              <iframe src="" style="flex:1;border:none;width:100%;background:#fff;" onerror="this.parentElement.innerHTML='<div class=\\'empty-state\\'><div class=\\'empty-icon\\'>📕</div><div class=\\'empty-title\\'>PDF 加载失败</div></div>'"></iframe>
            </div>
          `;
                    if (pathDisplay)
                        pathDisplay.textContent = currentPath;
                    if (saveBtn)
                        saveBtn.style.display = 'none';
                    if (undoBtn)
                        undoBtn.style.display = 'none';
                    if (redoBtn)
                        redoBtn.style.display = 'none';
                    const backBtn2 = document.getElementById('back-btn');
                    if (backBtn2)
                        backBtn2.style.display = '';
                    _undoHistory = [];
                    _undoIndex = -1;
                    return;
                }
                else if (binaryExts.includes(ext)) {
                    _isReadOnlyFile = true;
                    editor.innerHTML = `
            <div class="empty-state" style="height:100%;">
              <div class="empty-icon">🔒</div>
              <div class="empty-title">不支持预览此文件类型</div>
              <div class="empty-desc">.${ext} 文件为二进制格式，无法在编辑器中查看（${formatFileSize(currentContent.length)}）</div>
            </div>`;
                    if (saveBtn)
                        saveBtn.style.display = 'none';
                    if (undoBtn)
                        undoBtn.style.display = 'none';
                    if (redoBtn)
                        redoBtn.style.display = 'none';
                    _undoHistory = [];
                    _undoIndex = -1;
                    return;
                }
                // Text file — show textarea editor
                editor.innerHTML = '<textarea id="file-content" style="width:100%;height:100%;background:transparent;border:none;color:var(--text-primary);font-family:var(--font-mono);font-size:13px;padding:16px;resize:none;outline:none;line-height:1.6;"></textarea>';
                const textarea = document.getElementById('file-content');
                textarea.value = currentContent;
                textarea.addEventListener('input', () => {
                    _dirty = true;
                    pushUndoSnapshot();
                });
                // Ctrl+Z / Ctrl+Y keyboard shortcuts
                textarea.addEventListener('keydown', (e) => {
                    if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                        e.preventDefault();
                        performUndo();
                    }
                    else if (e.ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                        e.preventDefault();
                        performRedo();
                    }
                });
            }
            if (saveBtn)
                saveBtn.style.display = '';
            if (undoBtn)
                undoBtn.style.display = '';
            if (redoBtn)
                redoBtn.style.display = '';
            // Show markdown buttons for .md/.markdown files
            const mdExt = ['md', 'markdown'];
            const isMarkdown = mdExt.includes(ext);
            const mdEditBtn = document.getElementById('md-edit-btn');
            const mdPreviewBtn = document.getElementById('md-preview-btn');
            const mdSplitBtn = document.getElementById('md-split-btn');
            if (mdEditBtn)
                mdEditBtn.style.display = isMarkdown ? '' : 'none';
            if (mdPreviewBtn)
                mdPreviewBtn.style.display = isMarkdown ? '' : 'none';
            if (mdSplitBtn)
                mdSplitBtn.style.display = isMarkdown ? '' : 'none';
            // Reset diff view state
            _diffViewActive = false;
            _mdMode = 'edit';
            // Load undo cache from backend
            await loadUndoCache();
            updateUndoButtons();
        }
        catch (e) {
            Toast.error('读取文件失败');
        }
    }
    async function showDirectoryPreview(dirPath) {
        _currentDirPath = dirPath;
        const editor = document.getElementById('file-editor');
        const pathDisplay = document.getElementById('file-path-display');
        const saveBtn = document.getElementById('save-file-btn');
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        const backBtn = document.getElementById('back-btn');
        if (!editor)
            return;
        if (pathDisplay)
            pathDisplay.textContent = dirPath;
        if (saveBtn)
            saveBtn.style.display = 'none';
        if (undoBtn)
            undoBtn.style.display = 'none';
        if (redoBtn)
            redoBtn.style.display = 'none';
        if (backBtn)
            backBtn.style.display = '';
        const dirName = dirPath.split('/').pop() || dirPath.split('\\').pop() || dirPath;
        editor.innerHTML = `
      <div style="padding:20px;height:100%;overflow-y:auto;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <span style="font-size:28px;">📁</span>
          <div>
            <div style="font-size:18px;font-weight:700;">${escapeHtml(dirName)}</div>
            <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary);margin-top:2px;">${escapeHtml(dirPath)}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <button class="btn btn-sm btn-primary" id="dir-new-file-btn">+ 新建文件</button>
          <button class="btn btn-sm btn-secondary" id="dir-new-folder-btn">+ 新建文件夹</button>
        </div>
        <div id="dir-file-list" style="color:var(--text-muted);font-size:13px;">加载中...</div>
      </div>
    `;
        document.getElementById('dir-new-file-btn')?.addEventListener('click', () => {
            createFileInDir(dirPath);
        });
        document.getElementById('dir-new-folder-btn')?.addEventListener('click', () => {
            createFolderInDir(dirPath);
        });
        try {
            const res = await API.listFiles(dirPath);
            const items = Array.isArray(res.data) ? res.data : [];
            const listEl = document.getElementById('dir-file-list');
            if (!listEl)
                return;
            if (items.length === 0) {
                listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">空文件夹</div>';
                return;
            }
            const dirs = items.filter((i) => i.type === 'directory').sort((a, b) => a.name.localeCompare(b.name));
            const files = items.filter((i) => i.type !== 'directory').sort((a, b) => a.name.localeCompare(b.name));
            let html = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">${dirs.length} 个文件夹，${files.length} 个文件</div>`;
            html += '<div style="border:1px solid var(--border-subtle);border-radius:var(--border-radius-md);overflow:hidden;">';
            for (const item of [...dirs, ...files]) {
                const isDir = item.type === 'directory';
                const icon = isDir ? '📁' : getFileIcon(item.name);
                const size = isDir ? '' : formatFileSize(item.size || 0);
                html += `
          <div class="dir-list-item" data-path="${escapeHtml(item.path)}" data-type="${isDir ? 'directory' : 'file'}"
               style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border-subtle);transition:background 0.1s;"
               onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
            <span style="font-size:16px;flex-shrink:0;">${icon}</span>
            <span style="flex:1;font-family:var(--font-mono);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.name)}</span>
            <span style="font-size:11px;color:var(--text-muted);flex-shrink:0;">${size}</span>
          </div>
        `;
            }
            html += '</div>';
            listEl.innerHTML = html;
            listEl.querySelectorAll('.dir-list-item').forEach((el) => {
                el.addEventListener('click', () => {
                    const p = el.dataset.path;
                    const t = el.dataset.type;
                    onFileSelect(p, t);
                });
            });
        }
        catch (e) {
            const listEl = document.getElementById('dir-file-list');
            if (listEl)
                listEl.innerHTML = '<div style="color:var(--accent-red);">加载失败</div>';
        }
    }
    function getFileIcon(name) {
        const ext = (name.split('.').pop() || '').toLowerCase();
        const map = {
            js: '📜', ts: '📘', jsx: '⚛️', tsx: '⚛️', json: '📋', md: '📝', txt: '📄',
            html: '🌐', css: '🎨', py: '🐍', go: '🔵', rs: '🦀', java: '☕', c: '🔧', cpp: '🔧',
            sh: '🖥️', bat: '🖥️', yml: '⚙️', yaml: '⚙️', xml: '📄', sql: '🗃️',
            png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
            mp3: '🎵', wav: '🎵', mp4: '🎬', avi: '🎬', pdf: '📕', zip: '📦', tar: '📦', gz: '📦',
        };
        return map[ext] || '📄';
    }
    function formatFileSize(bytes) {
        if (!bytes || bytes === 0)
            return '';
        if (bytes < 1024)
            return bytes + ' B';
        if (bytes < 1024 * 1024)
            return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
    function createFileInDir(dirPath) {
        Modal.open({
            title: '新建文件',
            body: `
        <div class="form-group">
          <label class="form-label">文件名</label>
          <input class="input" id="new-file-name-input" placeholder="example.txt" style="font-family:var(--font-mono);">
        </div>
      `,
            footer: '<button class="btn btn-primary" id="confirm-new-file-btn">创建</button>',
            onOpen: () => {
                document.getElementById('new-file-name-input')?.focus();
                document.getElementById('confirm-new-file-btn')?.addEventListener('click', async () => {
                    const name = document.getElementById('new-file-name-input')?.value?.trim();
                    if (!name) {
                        Toast.warning('请输入文件名');
                        return;
                    }
                    const sep = dirPath.includes('/') ? '/' : '\\';
                    const fullPath = dirPath + sep + name;
                    try {
                        await API.writeFile(fullPath, '');
                        Toast.success('文件已创建');
                        Modal.close();
                        await loadTree();
                        onFileSelect(fullPath, 'file');
                    }
                    catch (e) {
                        Toast.error('创建失败: ' + e.message);
                    }
                });
            }
        });
    }
    function createFolderInDir(dirPath) {
        Modal.open({
            title: '新建文件夹',
            body: `
        <div class="form-group">
          <label class="form-label">文件夹名</label>
          <input class="input" id="new-folder-name-input" placeholder="new-folder" style="font-family:var(--font-mono);">
        </div>
      `,
            footer: '<button class="btn btn-primary" id="confirm-new-folder-btn">创建</button>',
            onOpen: () => {
                document.getElementById('new-folder-name-input')?.focus();
                document.getElementById('confirm-new-folder-btn')?.addEventListener('click', async () => {
                    const name = document.getElementById('new-folder-name-input')?.value?.trim();
                    if (!name) {
                        Toast.warning('请输入文件夹名');
                        return;
                    }
                    const sep = dirPath.includes('/') ? '/' : '\\';
                    const fullPath = dirPath + sep + name;
                    try {
                        await API.mkdir(fullPath);
                        Toast.success('文件夹已创建');
                        Modal.close();
                        await loadTree();
                        showDirectoryPreview(dirPath);
                    }
                    catch (e) {
                        Toast.error('创建失败: ' + e.message);
                    }
                });
            }
        });
    }
    function handleContextMenu(action, path, type) {
        if (action === 'copyPath') {
            navigator.clipboard.writeText(path).then(() => Toast.success('路径已复制'), () => Toast.error('复制失败'));
        }
        else if (action === 'rename') {
            const oldName = path.split('/').pop() || path.split('\\').pop();
            Modal.open({
                title: '重命名',
                body: `
          <div class="form-group">
            <label class="form-label">新名称</label>
            <input class="input" id="rename-input" value="${escapeHtml(oldName)}" style="font-family:var(--font-mono);font-size:13px;">
          </div>
        `,
                footer: `
          <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
          <button class="btn btn-primary" id="rename-confirm-btn">确认</button>
        `,
            });
            const input = document.getElementById('rename-input');
            const confirmBtn = document.getElementById('rename-confirm-btn');
            if (input) {
                input.select();
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter')
                        confirmBtn?.click();
                });
            }
            if (confirmBtn) {
                confirmBtn.addEventListener('click', async () => {
                    const newName = input?.value.trim();
                    if (!newName || newName === oldName) {
                        Modal.close();
                        return;
                    }
                    try {
                        const dir = path.substring(0, path.lastIndexOf('/') + 1) || path.substring(0, path.lastIndexOf('\\') + 1);
                        await API.renameFile(path, dir + newName);
                        Toast.success('重命名成功');
                        Modal.close();
                        await loadTree();
                    }
                    catch (e) {
                        Toast.error(e.message || '重命名失败');
                    }
                });
            }
        }
        else if (action === 'delete') {
            const name = path.split('/').pop() || path.split('\\').pop();
            Modal.open({
                title: '确认删除',
                body: `<div style="padding:8px 0;">确定要删除 <strong>${escapeHtml(name)}</strong> 吗？此操作不可撤销。</div>`,
                footer: `
          <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
          <button class="btn btn-danger" id="delete-confirm-btn">删除</button>
        `,
            });
            document.getElementById('delete-confirm-btn')?.addEventListener('click', async () => {
                try {
                    await API.deleteFile(path);
                    Toast.success('已删除');
                    Modal.close();
                    if (currentPath === path) {
                        currentPath = '';
                        _undoHistory = [];
                        _undoIndex = -1;
                        const editor = document.getElementById('file-editor');
                        if (editor)
                            editor.innerHTML = '<div class="empty-state" style="height:100%;"><div class="empty-icon">▤</div><div class="empty-title">未选择文件</div></div>';
                        const saveBtn = document.getElementById('save-file-btn');
                        if (saveBtn)
                            saveBtn.style.display = 'none';
                        const undoBtn = document.getElementById('undo-btn');
                        const redoBtn = document.getElementById('redo-btn');
                        const backBtn = document.getElementById('back-btn');
                        if (undoBtn)
                            undoBtn.style.display = 'none';
                        if (redoBtn)
                            redoBtn.style.display = 'none';
                        if (backBtn)
                            backBtn.style.display = 'none';
                    }
                    await loadTree();
                }
                catch (e) {
                    Toast.error(e.message || '删除失败');
                }
            });
        }
    }
    async function saveFile() {
        if (!currentPath)
            return;
        const textarea = document.getElementById('file-content');
        const content = textarea ? textarea.value : currentContent;
        const btn = document.getElementById('save-file-btn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '保存中...';
        }
        try {
            await API.writeFile(currentPath, content);
            currentContent = content;
            _dirty = false;
            await saveUndoCacheToBackend();
            Toast.success('文件已保存');
        }
        catch (e) {
            Toast.error(e.message);
        }
        finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '保存';
            }
        }
    }
    async function createWorkspace() {
        DirectoryBrowser.open({
            title: '选择工作区位置',
            onConfirm: async (parentPath) => {
                // After selecting location, prompt for workspace name
                Modal.open({
                    title: '创建工作区',
                    body: `
            <div class="form-group">
              <label class="form-label">工作区名称</label>
              <input class="input" id="workspace-name-input" placeholder="请输入工作区名称" maxlength="100">
            </div>
            <div style="font-size:12px;color:var(--text-tertiary);">
              将在 ${escapeHtml(parentPath || '/')} 下创建工作区
            </div>
          `,
                    footer: `
            <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
            <button class="btn btn-primary" id="workspace-confirm-btn">创建</button>
          `,
                });
                // Bind confirm button
                const confirmBtn = document.getElementById('workspace-confirm-btn');
                const nameInput = document.getElementById('workspace-name-input');
                if (confirmBtn) {
                    confirmBtn.addEventListener('click', async () => {
                        const name = nameInput?.value.trim();
                        if (!name) {
                            Toast.warning('请输入工作区名称');
                            return;
                        }
                        try {
                            const res = await API.createWorkspace(name, parentPath);
                            Toast.success('工作区已创建并已激活');
                            Modal.close();
                            // 刷新工作区列表（新工作区已自动激活注册，但当前工作区不变）
                            await loadWorkspacesList();
                            updateNavbarWorkspaceCount();
                        }
                        catch (e) {
                            Toast.error(e.message);
                        }
                    });
                }
                if (nameInput) {
                    nameInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter')
                            confirmBtn?.click();
                    });
                    nameInput.focus();
                }
            },
        });
    }
    async function createFile() {
        Modal.open({
            title: '新建文件',
            body: `
        <div class="form-group">
          <label class="form-label">文件路径</label>
          <input class="input" id="new-file-path" placeholder="输入文件路径，如 src/index.js 或 D:/project/index.js" style="font-family:var(--font-mono);font-size:13px;">
        </div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">
          相对路径基于工作区根目录，也可输入绝对路径访问系统任意位置
        </div>
      `,
            footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="new-file-confirm">创建</button>
      `,
        });
        const input = document.getElementById('new-file-path');
        const confirmBtn = document.getElementById('new-file-confirm');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', async () => {
                const p = input?.value.trim();
                if (!p) {
                    Toast.warning('请输入文件路径');
                    return;
                }
                try {
                    await API.writeFile(p, '');
                    Toast.success('文件已创建');
                    Modal.close();
                    await loadTree();
                }
                catch (e) {
                    Toast.error(e.message);
                }
            });
        }
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter')
                    confirmBtn?.click();
            });
            input.focus();
        }
    }
    async function createFolder() {
        Modal.open({
            title: '新建文件夹',
            body: `
        <div class="form-group">
          <label class="form-label">文件夹路径</label>
          <input class="input" id="new-folder-path" placeholder="输入文件夹路径，如 src/utils 或 D:/project/assets" style="font-family:var(--font-mono);font-size:13px;">
        </div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">
          相对路径基于工作区根目录，也可输入绝对路径访问系统任意位置
        </div>
      `,
            footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="new-folder-confirm">创建</button>
      `,
        });
        const input = document.getElementById('new-folder-path');
        const confirmBtn = document.getElementById('new-folder-confirm');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', async () => {
                const p = input?.value.trim();
                if (!p) {
                    Toast.warning('请输入文件夹路径');
                    return;
                }
                try {
                    await API.mkdir(p);
                    Toast.success('文件夹已创建');
                    Modal.close();
                    await loadTree();
                }
                catch (e) {
                    Toast.error(e.message);
                }
            });
        }
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter')
                    confirmBtn?.click();
            });
            input.focus();
        }
    }
    async function loadWorkspaceInfo() {
        try {
            const res = await API.getWorkspaceInfo();
            const display = document.getElementById('workspace-path-display');
            if (display && res?.data) {
                const wsPath = res.data.path;
                if (!wsPath) {
                    display.innerHTML = '<span style="color:var(--text-muted);">无工作区 — 请激活或创建工作区</span>';
                }
                else {
                    let text = escapeHtml(wsPath);
                    if (res.data.isDefault) {
                        text += ' <span style="color:var(--text-muted);font-size:11px;">(默认)</span>';
                    }
                    display.innerHTML = text;
                }
            }
        }
        catch (e) {
            const display = document.getElementById('workspace-path-display');
            if (display)
                display.textContent = '无法获取工作区信息';
        }
    }
    async function switchWorkspace() {
        try {
            DirectoryBrowser.open({
                title: '切换工作区',
                onConfirm: async (selectedPath) => {
                    try {
                        const res = await API.setWorkspace(selectedPath);
                        Toast.success('工作区已切换');
                        // Update Store with state data if available
                        if (res?.data?.state && typeof Store !== 'undefined' && Store.setState) {
                            Store.setState(res.data.state);
                        }
                        // Notify Navbar to refresh workspace display
                        if (typeof Navbar !== 'undefined' && Navbar.loadCurrentWorkspace) {
                            Navbar.loadCurrentWorkspace();
                        }
                        await loadWorkspaceInfo();
                        await loadTree();
                        // Offer to import workflows into the new workspace
                        await showImportWorkflowsDialog(selectedPath);
                    }
                    catch (e) {
                        Toast.error(e.message || '切换工作区失败');
                    }
                },
            });
        }
        catch (e) {
            Toast.error(e.message || '切换工作区失败');
        }
    }
    async function showImportWorkflowsDialog(workspacePath) {
        try {
            const res = await API.getWorkflows({ limit: 9999 });
            const d = res.data;
            const allWorkflows = Array.isArray(d) ? d : (d?.items || []);
            // Find workflows whose folderPath is set but different from the new workspace
            const importable = allWorkflows.filter((wf) => {
                if (!wf.folderPath)
                    return false; // global already
                return wf.folderPath !== workspacePath;
            });
            if (importable.length === 0)
                return;
            Modal.open({
                title: '导入工作流到新工作区',
                body: `
          <div style="margin-bottom:12px;font-size:12px;color:var(--text-secondary);">
            检测到 ${importable.length} 个工作流绑定在其他工作区。选择要导入到当前工作区的工作流：
          </div>
          <div style="max-height:400px;overflow-y:auto;">
            <div style="padding:8px 12px;border-bottom:1px solid var(--border-subtle);margin-bottom:8px;">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600;">
                <input type="checkbox" id="import-wf-select-all" checked> 全选
              </label>
            </div>
            ${importable.map((wf) => `
              <div class="card import-wf-item" data-id="${wf.id}" style="padding:10px 12px;margin-bottom:6px;cursor:pointer;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <input type="checkbox" class="import-wf-cb" data-id="${wf.id}" checked style="flex-shrink:0;">
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;">${escapeHtml(wf.name)}</div>
                    <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                      原路径: ${escapeHtml(wf.folderPath || '无')}
                    </div>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `,
                footer: `
          <button class="btn btn-secondary" id="import-wf-skip">跳过</button>
          <button class="btn btn-primary" id="import-wf-confirm">导入选中</button>
        `,
            });
            const selectAllCb = document.getElementById('import-wf-select-all');
            const wfCbs = document.querySelectorAll('.import-wf-cb');
            const confirmBtn = document.getElementById('import-wf-confirm');
            selectAllCb?.addEventListener('change', () => {
                wfCbs.forEach((cb) => { cb.checked = selectAllCb.checked; });
            });
            document.querySelectorAll('.import-wf-item').forEach((el) => {
                el.addEventListener('click', (e) => {
                    if (e.target.type === 'checkbox')
                        return;
                    const cb = el.querySelector('.import-wf-cb');
                    if (cb)
                        cb.checked = !cb.checked;
                });
            });
            document.getElementById('import-wf-skip')?.addEventListener('click', () => Modal.close());
            confirmBtn?.addEventListener('click', async () => {
                const selectedIds = Array.from(document.querySelectorAll('.import-wf-cb:checked')).map((cb) => cb.dataset.id);
                if (selectedIds.length === 0) {
                    Modal.close();
                    return;
                }
                let imported = 0;
                for (const wfId of selectedIds) {
                    try {
                        // Clear folderPath so the workflow runs in the new workspace
                        await API.setWorkflowFolder(wfId, '');
                        imported++;
                    }
                    catch (e) {
                        console.warn('导入工作流失败:', wfId, e.message);
                    }
                }
                Modal.close();
                Toast.success(`已导入 ${imported} 个工作流到当前工作区`);
            });
        }
        catch (e) {
            console.warn('检查工作流导入失败:', e.message);
        }
    }
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }
    // ── Back Navigation ──
    function computeParentPath(p) {
        // Normalize separators
        const normalized = p.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash <= 0)
            return '';
        return normalized.substring(0, lastSlash);
    }
    async function navigateBack() {
        if (_dirty) {
            const confirmed = await Modal.confirm('未保存的更改', '文件已修改但未保存，确定离开吗？');
            if (!confirmed)
                return;
            await saveUndoCacheToBackend();
            _dirty = false;
        }
        if (_isReadOnlyFile || (currentPath && !_currentDirPath)) {
            // Currently viewing a file — go to its parent directory
            const parent = computeParentPath(currentPath);
            if (parent) {
                currentPath = '';
                _isReadOnlyFile = false;
                showDirectoryPreview(parent);
            }
        }
        else if (_currentDirPath) {
            // Currently in directory preview — go to parent directory
            const parent = computeParentPath(_currentDirPath);
            if (parent) {
                showDirectoryPreview(parent);
            }
            else {
                // At or near root — go back to file tree default view
                _currentDirPath = '';
                currentPath = '';
                const editor = document.getElementById('file-editor');
                const pathDisplay = document.getElementById('file-path-display');
                const saveBtn = document.getElementById('save-file-btn');
                const backBtn = document.getElementById('back-btn');
                const undoBtn = document.getElementById('undo-btn');
                const redoBtn = document.getElementById('redo-btn');
                if (editor) {
                    editor.innerHTML = '<div class="empty-state" style="height:100%;"><div class="empty-icon">▤</div><div class="empty-title">未选择文件</div><div class="empty-desc">点击文件树中的文件查看其内容</div></div>';
                }
                if (pathDisplay)
                    pathDisplay.textContent = '请选择要查看的文件';
                if (saveBtn)
                    saveBtn.style.display = 'none';
                if (backBtn)
                    backBtn.style.display = 'none';
                if (undoBtn)
                    undoBtn.style.display = 'none';
                if (redoBtn)
                    redoBtn.style.display = 'none';
            }
        }
    }
    // ── Undo / Redo ──
    function pushUndoSnapshot() {
        const textarea = document.getElementById('file-content');
        if (!textarea)
            return;
        const content = textarea.value;
        // If we're not at the end of history, truncate forward history
        if (_undoIndex < _undoHistory.length - 1) {
            _undoHistory = _undoHistory.slice(0, _undoIndex + 1);
        }
        // Don't push duplicate of the current state
        if (_undoHistory.length > 0 && _undoHistory[_undoIndex] === content)
            return;
        _undoHistory.push(content);
        // Enforce max size
        if (_undoHistory.length > UNDO_MAX) {
            _undoHistory = _undoHistory.slice(_undoHistory.length - UNDO_MAX);
        }
        _undoIndex = _undoHistory.length - 1;
        updateUndoButtons();
        debouncedSaveUndoCache();
    }
    function performUndo() {
        if (_undoIndex <= 0)
            return;
        _undoIndex--;
        const textarea = document.getElementById('file-content');
        if (textarea) {
            textarea.value = _undoHistory[_undoIndex];
            _dirty = _undoHistory[_undoIndex] !== currentContent;
        }
        updateUndoButtons();
        debouncedSaveUndoCache();
    }
    function performRedo() {
        if (_undoIndex >= _undoHistory.length - 1)
            return;
        _undoIndex++;
        const textarea = document.getElementById('file-content');
        if (textarea) {
            textarea.value = _undoHistory[_undoIndex];
            _dirty = _undoHistory[_undoIndex] !== currentContent;
        }
        updateUndoButtons();
        debouncedSaveUndoCache();
    }
    function updateUndoButtons() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        if (undoBtn)
            undoBtn.disabled = _undoIndex <= 0;
        if (redoBtn)
            redoBtn.disabled = _undoIndex >= _undoHistory.length - 1;
    }
    // ── Undo Cache Persistence ──
    function debouncedSaveUndoCache() {
        if (_undoCacheSaveTimer)
            clearTimeout(_undoCacheSaveTimer);
        _undoCacheSaveTimer = setTimeout(() => {
            saveUndoCacheToBackend();
        }, 2000);
    }
    async function saveUndoCacheToBackend() {
        if (!currentPath || _undoHistory.length === 0)
            return;
        try {
            await API.saveUndoCache({ path: currentPath, history: _undoHistory, currentIndex: _undoIndex });
        }
        catch (e) {
            // Silent fail — undo cache is non-critical
        }
    }
    async function loadUndoCache() {
        if (!currentPath) {
            _undoHistory = [];
            _undoIndex = -1;
            return;
        }
        try {
            const res = await API.getUndoCache(currentPath);
            if (res?.data && Array.isArray(res.data.history) && res.data.history.length > 0) {
                _undoHistory = res.data.history;
                _undoIndex = typeof res.data.currentIndex === 'number' ? res.data.currentIndex : _undoHistory.length - 1;
                // Clamp index
                if (_undoIndex < 0)
                    _undoIndex = 0;
                if (_undoIndex >= _undoHistory.length)
                    _undoIndex = _undoHistory.length - 1;
            }
            else {
                _undoHistory = [currentContent];
                _undoIndex = 0;
            }
        }
        catch (e) {
            _undoHistory = [currentContent];
            _undoIndex = 0;
        }
    }
    // ── Diff Viewer ──
    async function toggleDiffView() {
        if (_diffViewActive) {
            closeDiffView();
            return;
        }
        if (!currentPath)
            return;
        await showDiffView(currentPath);
    }
    async function showDiffView(filePath) {
        try {
            const res = await API.getGitDiff(filePath);
            const diff = res.data?.diff || '';
            if (!diff) {
                Toast.info('没有差异');
                return;
            }
            _diffViewActive = true;
            const editor = document.getElementById('file-editor');
            if (!editor)
                return;
            const parsed = parseDiff(diff);
            editor.innerHTML = `
        <div class="diff-viewer">
          <div class="diff-viewer-header">
            <span style="font-size:12px;font-weight:600;font-family:var(--font-mono);">${escapeHtml(filePath)}</span>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-sm btn-secondary" id="diff-toggle-mode">${_diffSplitMode ? '统一切换' : '分屏切换'}</button>
              <button class="btn btn-sm btn-ghost" id="diff-close-btn">✕ 关闭</button>
            </div>
          </div>
          <div class="diff-viewer-body ${_diffSplitMode ? 'split' : ''}" id="diff-viewer-body">
            ${_diffSplitMode ? renderSplitDiff(parsed) : renderUnifiedDiff(parsed)}
          </div>
        </div>
      `;
            document.getElementById('diff-close-btn').addEventListener('click', closeDiffView);
            document.getElementById('diff-toggle-mode').addEventListener('click', () => {
                _diffSplitMode = !_diffSplitMode;
                showDiffView(filePath);
            });
            // Show the diff/close buttons, hide normal editor buttons
            const saveBtn = document.getElementById('save-file-btn');
            const undoBtn = document.getElementById('undo-btn');
            const redoBtn = document.getElementById('redo-btn');
            if (saveBtn)
                saveBtn.style.display = 'none';
            if (undoBtn)
                undoBtn.style.display = 'none';
            if (redoBtn)
                redoBtn.style.display = 'none';
        }
        catch (e) {
            Toast.error('获取差异失败: ' + e.message);
        }
    }
    function closeDiffView() {
        _diffViewActive = false;
        if (currentPath) {
            onFileSelect(currentPath, 'file');
        }
    }
    function parseDiff(diff) {
        const lines = diff.split('\n');
        const hunks = [];
        let currentHunk = null;
        for (const line of lines) {
            if (line.startsWith('@@')) {
                if (currentHunk)
                    hunks.push(currentHunk);
                currentHunk = { header: line, lines: [] };
            }
            else if (currentHunk) {
                if (line.startsWith('+')) {
                    currentHunk.lines.push({ type: 'added', content: line.substring(1) });
                }
                else if (line.startsWith('-')) {
                    currentHunk.lines.push({ type: 'removed', content: line.substring(1) });
                }
                else {
                    currentHunk.lines.push({ type: 'context', content: line.startsWith(' ') ? line.substring(1) : line });
                }
            }
        }
        if (currentHunk)
            hunks.push(currentHunk);
        return hunks;
    }
    function renderSplitDiff(hunks) {
        let leftHtml = '';
        let rightHtml = '';
        let leftNum = 0;
        let rightNum = 0;
        for (const hunk of hunks) {
            leftHtml += `<div class="diff-hunk-header">${escapeHtml(hunk.header)}</div>`;
            rightHtml += `<div class="diff-hunk-header">${escapeHtml(hunk.header)}</div>`;
            for (const line of hunk.lines) {
                if (line.type === 'context') {
                    leftNum++;
                    rightNum++;
                    leftHtml += renderDiffLine(leftNum, line.content, 'context');
                    rightHtml += renderDiffLine(rightNum, line.content, 'context');
                }
                else if (line.type === 'removed') {
                    leftNum++;
                    leftHtml += renderDiffLine(leftNum, line.content, 'removed');
                    rightHtml += `<div class="diff-line" style="visibility:hidden;"><span class="diff-line-num"></span><span class="diff-line-content">&nbsp;</span></div>`;
                }
                else if (line.type === 'added') {
                    rightNum++;
                    leftHtml += `<div class="diff-line" style="visibility:hidden;"><span class="diff-line-num"></span><span class="diff-line-content">&nbsp;</span></div>`;
                    rightHtml += renderDiffLine(rightNum, line.content, 'added');
                }
            }
        }
        return `<div class="diff-pane">${leftHtml}</div><div class="diff-pane">${rightHtml}</div>`;
    }
    function renderUnifiedDiff(hunks) {
        let html = '';
        let num = 0;
        for (const hunk of hunks) {
            html += `<div class="diff-hunk-header">${escapeHtml(hunk.header)}</div>`;
            for (const line of hunk.lines) {
                if (line.type === 'context') {
                    num++;
                    html += renderDiffLine(num, line.content, 'context');
                }
                else if (line.type === 'removed') {
                    html += renderDiffLine('', line.content, 'removed');
                }
                else if (line.type === 'added') {
                    num++;
                    html += renderDiffLine(num, line.content, 'added');
                }
            }
        }
        return html;
    }
    function renderDiffLine(num, content, type) {
        return `
      <div class="diff-line ${type}">
        <span class="diff-line-num">${num}</span>
        <span class="diff-line-content">${escapeHtml(content)}</span>
      </div>
    `;
    }
    // ── Markdown Preview ──
    function switchMdMode(mode) {
        _mdMode = mode;
        const editor = document.getElementById('file-editor');
        if (!editor)
            return;
        const textarea = document.getElementById('file-content');
        const content = textarea ? textarea.value : currentContent;
        // Update button styles
        const editBtn = document.getElementById('md-edit-btn');
        const previewBtn = document.getElementById('md-preview-btn');
        const splitBtn = document.getElementById('md-split-btn');
        if (editBtn)
            editBtn.className = 'btn btn-sm ' + (mode === 'edit' ? 'btn-primary' : 'btn-secondary');
        if (previewBtn)
            previewBtn.className = 'btn btn-sm ' + (mode === 'preview' ? 'btn-primary' : 'btn-secondary');
        if (splitBtn)
            splitBtn.className = 'btn btn-sm ' + (mode === 'split' ? 'btn-primary' : 'btn-secondary');
        if (mode === 'edit') {
            editor.innerHTML = '<textarea id="file-content" style="width:100%;height:100%;background:transparent;border:none;color:var(--text-primary);font-family:var(--font-mono);font-size:13px;padding:16px;resize:none;outline:none;line-height:1.6;"></textarea>';
            const newTa = document.getElementById('file-content');
            newTa.value = content;
            newTa.addEventListener('input', () => { _dirty = true; pushUndoSnapshot(); });
            newTa.addEventListener('keydown', handleEditorKeydown);
        }
        else if (mode === 'preview') {
            editor.innerHTML = `<div class="md-preview" id="md-preview-area">${renderMarkdown(content)}</div>`;
        }
        else if (mode === 'split') {
            editor.innerHTML = `
        <div class="md-editor-split" style="display:flex;height:100%;">
          <div class="md-editor-pane" id="split-editor-pane" style="flex:1;overflow:auto;min-width:100px;">
            <textarea id="file-content" style="width:100%;height:100%;background:transparent;border:none;color:var(--text-primary);font-family:var(--font-mono);font-size:13px;padding:16px;resize:none;outline:none;line-height:1.6;">${escapeHtml(content)}</textarea>
          </div>
          <div id="split-drag-handle" style="width:4px;cursor:col-resize;flex-shrink:0;background:var(--border-subtle);transition:background 0.15s;margin:0 2px;border-radius:2px;"></div>
          <div class="md-preview-pane md-preview" id="md-preview-area" style="flex:1;overflow:auto;min-width:100px;border-left:none;">${renderMarkdown(content)}</div>
        </div>
      `;
            // Bind split drag handle
            const splitHandle = document.getElementById('split-drag-handle');
            const editorPane = document.getElementById('split-editor-pane');
            if (splitHandle && editorPane) {
                let _sDragStart = 0;
                let _sStartWidth = 0;
                splitHandle.addEventListener('mousedown', (e) => {
                    _sDragStart = e.clientX;
                    _sStartWidth = editorPane.offsetWidth;
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';
                    const onSDrag = (ev) => {
                        const diff = ev.clientX - _sDragStart;
                        const parentW = editorPane.parentElement.offsetWidth;
                        const pct = Math.max(20, Math.min(80, ((_sStartWidth + diff) / parentW) * 100));
                        editorPane.style.flex = 'none';
                        editorPane.style.width = pct + '%';
                    };
                    const onSDragEnd = () => {
                        document.body.style.cursor = '';
                        document.body.style.userSelect = '';
                        document.removeEventListener('mousemove', onSDrag);
                        document.removeEventListener('mouseup', onSDragEnd);
                    };
                    document.addEventListener('mousemove', onSDrag);
                    document.addEventListener('mouseup', onSDragEnd);
                });
                splitHandle.addEventListener('mouseenter', () => { splitHandle.style.background = 'var(--accent-cyan)'; });
                splitHandle.addEventListener('mouseleave', () => { splitHandle.style.background = 'var(--border-subtle)'; });
            }
            const newTa = document.getElementById('file-content');
            if (newTa) {
                newTa.addEventListener('input', () => {
                    _dirty = true;
                    pushUndoSnapshot();
                    const preview = document.getElementById('md-preview-area');
                    if (preview)
                        preview.innerHTML = renderMarkdown(newTa.value);
                });
                newTa.addEventListener('keydown', handleEditorKeydown);
            }
        }
    }
    function handleEditorKeydown(e) {
        if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            performUndo();
        }
        else if (e.ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            e.preventDefault();
            performRedo();
        }
    }
    function renderMarkdown(text) {
        if (!text)
            return '';
        let html = escapeHtml(text);
        // Code blocks (fenced)
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
            return `<pre><code>${code}</code></pre>`;
        });
        // Headers
        html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        // Horizontal rule
        html = html.replace(/^---$/gm, '<hr>');
        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Italic
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        // Images
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
        // Blockquotes
        html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
        // Unordered lists
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);
        // Paragraphs (double newline)
        html = html.replace(/\n\n/g, '</p><p>');
        html = '<p>' + html + '</p>';
        // Clean up empty paragraphs
        html = html.replace(/<p>\s*<\/p>/g, '');
        html = html.replace(/<p>\s*(<h[1-6]>)/g, '$1');
        html = html.replace(/(<\/h[1-6]>)\s*<\/p>/g, '$1');
        html = html.replace(/<p>\s*(<pre>)/g, '$1');
        html = html.replace(/(<\/pre>)\s*<\/p>/g, '$1');
        html = html.replace(/<p>\s*(<ul>)/g, '$1');
        html = html.replace(/(<\/ul>)\s*<\/p>/g, '$1');
        html = html.replace(/<p>\s*(<blockquote>)/g, '$1');
        html = html.replace(/(<\/blockquote>)\s*<\/p>/g, '$1');
        html = html.replace(/<p>\s*(<hr>)/g, '$1');
        html = html.replace(/(<hr>)\s*<\/p>/g, '$1');
        return html;
    }
    // ── Import File Dialog ──
    function openImportDialog() {
        Modal.open({
            title: '导入文件',
            body: `
        <div style="display:flex;flex-direction:column;gap:16px;">
          <div>
            <div style="font-size:13px;font-weight:600;margin-bottom:8px;">方式一：从本地选择文件</div>
            <div style="color:var(--text-muted);font-size:12px;margin-bottom:8px;">选择本地文件上传到当前工作区</div>
            <input type="file" id="import-file-input" style="display:none;" multiple>
            <button class="btn btn-primary" id="import-choose-file-btn">选择文件</button>
          </div>
          <div style="border-top:1px solid var(--border-subtle);padding-top:16px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px;">方式二：输入文件绝对路径</div>
            <div style="color:var(--text-muted);font-size:12px;margin-bottom:8px;">输入服务器上的文件绝对路径导入</div>
            <div style="display:flex;gap:8px;">
              <input class="input" id="import-source-path" placeholder="D:/some/path/file.txt" style="flex:1;font-family:var(--font-mono);font-size:13px;">
              <button class="btn btn-secondary" id="import-by-path-btn">输入路径</button>
            </div>
          </div>
        </div>
      `,
        });
        // Bind events after modal is rendered
        const fileInput = document.getElementById('import-file-input');
        const chooseBtn = document.getElementById('import-choose-file-btn');
        const byPathBtn = document.getElementById('import-by-path-btn');
        const sourcePathInput = document.getElementById('import-source-path');
        chooseBtn?.addEventListener('click', () => {
            fileInput?.click();
        });
        fileInput?.addEventListener('change', async () => {
            const files = fileInput.files;
            if (!files || files.length === 0)
                return;
            let imported = 0;
            for (const file of Array.from(files)) {
                try {
                    const content = await readFileAsText(file);
                    const targetPath = file.name; // relative to workspace
                    await API.writeFile(targetPath, content);
                    imported++;
                }
                catch (e) {
                    Toast.error(`导入 ${file.name} 失败: ${e.message}`);
                }
            }
            if (imported > 0) {
                Toast.success(`已成功导入 ${imported} 个文件`);
                Modal.close();
                await loadTree();
            }
        });
        byPathBtn?.addEventListener('click', async () => {
            const sourcePath = sourcePathInput?.value?.trim();
            if (!sourcePath) {
                Toast.warning('请输入源文件路径');
                return;
            }
            try {
                // Compute a default target path from the source filename
                const fileName = sourcePath.split(/[/\\]/).pop() || sourcePath;
                const targetPath = await Modal.prompt('导入目标路径', `请输入导入到工作区的目标路径：`, fileName);
                if (targetPath === null)
                    return; // user cancelled
                await API.importFile(sourcePath, targetPath);
                Toast.success('文件已导入');
                Modal.close();
                await loadTree();
            }
            catch (e) {
                Toast.error(e.message || '导入失败');
            }
        });
        sourcePathInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter')
                byPathBtn?.click();
        });
    }
    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsText(file);
        });
    }
    function cleanup() {
        if (_beforeUnloadHandler) {
            window.removeEventListener('beforeunload', _beforeUnloadHandler);
            _beforeUnloadHandler = null;
        }
        if (_undoDebounceTimer) {
            clearTimeout(_undoDebounceTimer);
            _undoDebounceTimer = null;
        }
        if (_undoCacheSaveTimer) {
            clearTimeout(_undoCacheSaveTimer);
            _undoCacheSaveTimer = null;
        }
        // Save undo cache before leaving
        if (_dirty && currentPath) {
            saveUndoCacheToBackend();
        }
        _dirty = false;
        _undoHistory = [];
        _undoIndex = -1;
        _currentDirPath = '';
        _isReadOnlyFile = false;
        _diffViewActive = false;
        _mdMode = 'edit';
    }
    return { render, cleanup };
})();
