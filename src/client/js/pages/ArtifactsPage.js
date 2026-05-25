// ═══════════════════════════════════════════════
// Artifacts Page — Work Output Library
// ═══════════════════════════════════════════════

window.ArtifactsPage = (() => {
  let _artifacts = [];
  let _query = '';
  let _page = 1;
  let _searchSeq = 0;
  let _selected = new Set();
  let _selectionMode = false;

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  }

  function getFileIcon(mimeType) {
    return Icon.svg('files', 20);
  }

  function formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return `${bytes.toFixed(1)} ${units[i]}`;
  }

  async function render() {
    const el = document.getElementById('content');
    el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">${Icon.svg('artifacts', 20)}</span> 成果库</h1>
          <div style="display:flex;gap:8px;">
            <input class="input" id="artifact-search" placeholder="搜索文件..." style="width:200px;">
            <button class="btn btn-secondary" id="artifact-reindex-btn">重建索引</button>
            <button class="btn btn-secondary" id="artifact-batch-select-btn">批量选择</button>
            <button class="btn btn-danger" id="artifact-batch-delete-btn" style="display:none;">批量删除</button>
            <button class="btn btn-ghost" id="artifact-cancel-select-btn" style="display:none;">取消选择</button>
          </div>
        </div>
        <div id="artifact-stats" style="margin-bottom:16px;"></div>
        <div id="artifact-list"></div>
      </div>
    `;

    document.getElementById('artifact-search').addEventListener('input', debounce((e) => {
      _query = e.target.value;
      _page = 1;
      loadArtifacts();
    }, 300));

    document.getElementById('artifact-reindex-btn').addEventListener('click', reindex);
    document.getElementById('artifact-batch-select-btn').addEventListener('click', () => {
      _selectionMode = true;
      _selected.clear();
      updateSelectUI();
      loadArtifacts();
    });
    document.getElementById('artifact-cancel-select-btn').addEventListener('click', () => {
      _selectionMode = false;
      _selected.clear();
      updateSelectUI();
      loadArtifacts();
    });
    document.getElementById('artifact-batch-delete-btn').addEventListener('click', batchDelete);
    updateSelectUI();

    await loadArtifacts();
  }

  function renderArtifactCard(a) {
    const checked = _selected.has(a.id) ? 'checked' : '';
    return `
      <div class="card card-artifact card-enter hover-lift" style="padding:12px;cursor:pointer;position:relative;" data-id="${a.id}">
        ${_selectionMode ? `<div style="position:absolute;top:8px;left:8px;z-index:2;">
          <input type="checkbox" class="artifact-select-cb" data-id="${a.id}" ${checked} style="cursor:pointer;">
        </div>` : ''}
        <button class="btn btn-sm btn-danger artifact-delete-btn" data-id="${a.id}" data-name="${escapeHtml(a.fileName)}">删除</button>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:20px;">${getFileIcon(a.mimeType)}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(a.fileName)}</div>
            <div style="font-size:11px;color:var(--text-tertiary);">${escapeHtml(a.filePath)}</div>
          </div>
        </div>
        ${a.workflowName ? `<div style="font-size:11px;color:var(--accent-cyan);margin-bottom:4px;">来自: ${escapeHtml(a.workflowName)}</div>` : ''}
        <div style="font-size:11px;color:var(--text-muted);">${new Date(a.createdAt).toLocaleString()} · ${formatSize(a.size)}</div>
        ${a.contentPreview ? `<div class="text-clamp-2" style="font-size:11px;color:var(--text-tertiary);margin-top:6px;">${escapeHtml(a.contentPreview)}</div>` : ''}
      </div>
    `;
  }

  async function loadArtifacts() {
    const listEl = document.getElementById('artifact-list');
    if (!listEl) return;
    const seq = ++_searchSeq;
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">加载中...</div>';

    try {
      const res = await API.getArtifacts({ q: _query, page: _page, limit: 20 });
      if (seq !== _searchSeq) return;
      _artifacts = res.data?.items || [];
      const total = res.data?.total || 0;

      if (_artifacts.length === 0) {
        listEl.innerHTML = EmptyState.render({ icon: Icon.svg('artifacts', 40), title: '暂无成果文件', description: 'Agent 产出的文件会自动索引到这里' });
        return;
      }

      listEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
          ${_artifacts.map(a => renderArtifactCard(a)).join('')}
        </div>
        ${total > 20 ? `<div style="text-align:center;padding:16px;"><button class="btn btn-secondary" id="load-more-btn">加载更多 (${_artifacts.length}/${total})</button></div>` : ''}
      `;

      listEl.querySelectorAll('.card[data-id]').forEach(card => {
        card.addEventListener('click', () => previewArtifact(card.dataset.id));
      });

      bindCardListeners(listEl);
      const loadMoreBtn = document.getElementById('load-more-btn');
      if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => { _page++; loadMoreArtifacts(); });
      }
    } catch (e) {
      listEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--accent-red);">加载失败: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function loadMoreArtifacts() {
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = '加载中...';
    }

    try {
      const res = await API.getArtifacts({ q: _query, page: _page, limit: 20 });
      const newItems = res.data?.items || [];
      const total = res.data?.total || 0;
      _artifacts = _artifacts.concat(newItems);

      // Re-render the full list
      const listEl = document.getElementById('artifact-list');
      if (!listEl) return;

      listEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
          ${_artifacts.map(a => renderArtifactCard(a)).join('')}
        </div>
        ${_artifacts.length < total ? `<div style="text-align:center;padding:16px;"><button class="btn btn-secondary" id="load-more-btn">加载更多 (${_artifacts.length}/${total})</button></div>` : ''}
      `;

      bindCardListeners(listEl);
      const newLoadMoreBtn = document.getElementById('load-more-btn');
      if (newLoadMoreBtn) {
        newLoadMoreBtn.addEventListener('click', () => { _page++; loadMoreArtifacts(); });
      }
    } catch (e) {
      Toast.error('加载更多失败: ' + e.message);
      if (loadMoreBtn) {
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = '加载更多';
      }
    }
  }

  async function reindex() {
    try {
      const res = await API.reindexArtifacts();
      Toast.success(`已索引 ${res.data?.indexed || 0} 个文件`);
      await loadArtifacts();
    } catch (e) {
      Toast.error('重建索引失败: ' + e.message);
    }
  }

  async function previewArtifact(id) {
    try {
      const res = await API.getArtifactContent(id);
      const data = res.data || {};

      Modal.open({
        title: data.fileName || '文件预览',
        body: `
          <div style="margin-bottom:8px;font-size:12px;color:var(--text-tertiary);">
            路径: ${escapeHtml(data.filePath || '')} | 类型: ${escapeHtml(data.mimeType || '')}
          </div>
          <div class="code-block" style="max-height:500px;overflow:auto;">
            ${escapeHtml(data.content || '(空文件)')}
          </div>
        `,
        footer: `
          <button class="btn btn-secondary" onclick="Modal.close()">关闭</button>
        `
      });
    } catch (e) {
      Toast.error('加载文件内容失败: ' + e.message);
    }
  }

  async function batchDelete() {
    if (_selected.size === 0) { Toast.warning('请先选择文件'); return; }
    if (!confirm(`确定删除选中的 ${_selected.size} 个文件？此操作将同时删除实际文件。`)) return;
    let ok = 0, fail = 0;
    for (const id of _selected) {
      try { await API.deleteArtifact(id); ok++; } catch (e) { fail++; }
    }
    Toast.success(`已删除 ${ok} 个${fail > 0 ? `，${fail} 个失败` : ''}`);
    _selected.clear();
    _selectionMode = false;
    updateSelectUI();
    await loadArtifacts();
  }

  function bindCardListeners(listEl) {
    listEl.querySelectorAll('.card[data-id]').forEach(card => {
      card.addEventListener('click', () => previewArtifact(card.dataset.id));
    });
    listEl.querySelectorAll('.artifact-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        if (!confirm(`确定删除文件 "${name}"？此操作将同时删除实际文件。`)) return;
        try { await API.deleteArtifact(id); Toast.success(`已删除 ${name}`); await loadArtifacts(); } catch (e) { Toast.error('删除失败: ' + e.message); }
      });
    });
    listEl.querySelectorAll('.artifact-select-cb').forEach(cb => {
      cb.addEventListener('click', (e) => { e.stopPropagation(); });
      cb.addEventListener('change', () => {
        if (cb.checked) _selected.add(cb.dataset.id);
        else _selected.delete(cb.dataset.id);
        document.getElementById('artifact-batch-delete-btn').style.display = _selected.size > 0 ? '' : 'none';
      });
    });
  }

  function updateSelectUI() {
    const selectBtn = document.getElementById('artifact-batch-select-btn');
    const deleteBtn = document.getElementById('artifact-batch-delete-btn');
    const cancelBtn = document.getElementById('artifact-cancel-select-btn');
    if (selectBtn) selectBtn.style.display = _selectionMode ? 'none' : '';
    if (deleteBtn) deleteBtn.style.display = _selectionMode ? '' : 'none';
    if (cancelBtn) cancelBtn.style.display = _selectionMode ? '' : 'none';
  }

  function cleanup() {
    _artifacts = [];
    _query = '';
    _page = 1;
    _selected.clear();
    _selectionMode = false;
  }

  return { render, cleanup };
})();
