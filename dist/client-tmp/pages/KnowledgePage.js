"use strict";
window.KnowledgePage = (() => {
    let _entries = [];
    let _query = '';
    let _category = '';
    const PAGE_SIZE = 20;
    let _currentPage = 1;
    let _totalItems = 0;
    let _loadingMore = false;
    let _searchSeq = 0;
    async function render() {
        const el = document.getElementById('content');
        el.innerHTML = `
      <div class="page-enter">
        <div class="page-header">
          <h1 class="page-title"><span class="page-icon">${window.Icon.svg('knowledge', 20)}</span> 知识库</h1>
          <div style="display:flex;gap:8px;">
            <input class="input" id="kb-search" placeholder="搜索知识..." style="width:200px;">
            <select class="select" id="kb-category" style="width:120px;">
              <option value="">全部分类</option>
              <option value="general">通用</option>
              <option value="technical">技术</option>
              <option value="business">业务</option>
              <option value="personal">个人</option>
            </select>
            <button class="btn btn-primary" id="kb-add-btn">+ 新增</button>
            <button class="btn btn-secondary" id="kb-export-btn">导出</button>
            <button class="btn btn-secondary" id="kb-import-btn">导入</button>
          </div>
        </div>
        <div id="kb-list"></div>
      </div>
    `;
        document.getElementById('kb-search').addEventListener('input', debounce(() => {
            _query = document.getElementById('kb-search').value;
            _entries = [];
            _currentPage = 1;
            _totalItems = 0;
            loadEntries(1);
        }, 300));
        document.getElementById('kb-category').addEventListener('change', () => {
            _category = document.getElementById('kb-category').value;
            _entries = [];
            _currentPage = 1;
            _totalItems = 0;
            loadEntries(1);
        });
        document.getElementById('kb-add-btn').addEventListener('click', addEntry);
        document.getElementById('kb-export-btn').addEventListener('click', showExportDialog);
        document.getElementById('kb-import-btn').addEventListener('click', showImportDialog);
        await loadEntries();
    }
    async function loadEntries(page) {
        if (page === undefined)
            page = 1;
        const listEl = document.getElementById('kb-list');
        if (!listEl)
            return;
        if (_loadingMore)
            return;
        _loadingMore = true;
        const seq = ++_searchSeq;
        if (page === 1) {
            listEl.innerHTML = window.LoadingState.render('加载中...');
        }
        try {
            const res = await window.API.searchKnowledge(_query, { category: _category, page, limit: PAGE_SIZE });
            if (seq !== _searchSeq) {
                _loadingMore = false;
                return;
            }
            const data = res.data || {};
            const items = data.items || [];
            const total = data.total || 0;
            if (page === 1) {
                _entries = items;
            }
            else {
                _entries = [..._entries, ...items];
            }
            _currentPage = page;
            _totalItems = total;
            if (_entries.length === 0) {
                listEl.innerHTML = window.EmptyState.render({
                    icon: `${window.Icon.svg('knowledge', 40)}`,
                    title: '知识库为空',
                    description: '添加知识条目来积累你的知识',
                    actionText: '+ 新增知识',
                    actionId: 'empty-add-kb-btn'
                });
                document.getElementById('empty-add-kb-btn')?.addEventListener('click', addEntry);
                return;
            }
            listEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;">
          ${_entries.map(e => `
            <div class="card card-knowledge card-enter" style="padding:12px;cursor:pointer;" data-id="${e.id}">
              <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
                <div style="font-weight:600;font-size:13px;">${escapeHtml(e.title)}</div>
                <span style="font-size:10px;padding:2px 6px;background:var(--accent-primary-dim);color:var(--accent-primary);border-radius:4px;">${escapeHtml(e.category)}</span>
              </div>
              <div class="text-clamp-2" style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">${escapeHtml(e.content)}</div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;">
                ${(e.tags || []).map(t => `<span style="font-size:10px;padding:2px 6px;background:var(--bg-subtle);border-radius:4px;">${escapeHtml(t)}</span>`).join('')}
              </div>
              <div style="font-size:10px;color:var(--text-tertiary);margin-top:8px;">${new Date(e.updatedAt).toLocaleString('zh-CN')}</div>
            </div>
          `).join('')}
        </div>
        ${renderLoadMoreButton(_entries.length, _totalItems, 'load-more-kb')}
        <div style="text-align:center;padding:4px;font-size:12px;color:var(--text-muted);">已加载 ${_entries.length} / ${_totalItems} 条</div>
      `;
            listEl.querySelectorAll('.card[data-id]').forEach(card => {
                card.addEventListener('click', () => viewEntry(card.dataset.id));
            });
            window.bindLoadMoreButton('load-more-kb', () => loadEntries(_currentPage + 1));
        }
        catch (e) {
            listEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--accent-red);">加载失败: ${escapeHtml(e.message)}</div>`;
        }
        finally {
            _loadingMore = false;
        }
    }
    function renderLoadMoreButton(loaded, total, id) {
        return window.renderLoadMoreButton ? window.renderLoadMoreButton(loaded, total, id) : '';
    }
    async function addEntry() {
        window.Modal.open({
            title: '新增知识条目',
            body: `
        <div class="form-group">
          <label class="form-label">标题</label>
          <input class="input" id="kb-title" placeholder="输入标题">
        </div>
        <div class="form-group">
          <label class="form-label">内容</label>
          <textarea class="textarea" id="kb-content" rows="6" placeholder="输入内容"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">分类</label>
          <select class="select" id="kb-cat">
            <option value="general">通用</option>
            <option value="technical">技术</option>
            <option value="business">业务</option>
            <option value="personal">个人</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">标签（逗号分隔）</label>
          <input class="input" id="kb-tags" placeholder="标签1, 标签2">
        </div>
      `,
            footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="kb-save-btn">保存</button>
      `
        });
        document.getElementById('kb-save-btn').addEventListener('click', async () => {
            const title = document.getElementById('kb-title')?.value.trim();
            const content = document.getElementById('kb-content')?.value.trim();
            const category = document.getElementById('kb-cat')?.value;
            const tags = document.getElementById('kb-tags')?.value.split(',').map(t => t.trim()).filter(Boolean);
            if (!title || !content) {
                window.Toast.warning('标题和内容为必填');
                return;
            }
            try {
                await window.API.addKnowledge({ title, content, category, tags });
                window.Toast.success('已添加');
                window.Modal.close();
                await loadEntries();
            }
            catch (e) {
                window.Toast.error('添加失败: ' + e.message);
            }
        });
    }
    async function viewEntry(id) {
        const entry = _entries.find(e => e.id === id);
        if (!entry)
            return;
        window.Modal.open({
            title: entry.title,
            body: `
        <div style="margin-bottom:8px;font-size:12px;color:var(--text-tertiary);">
          分类: ${escapeHtml(entry.category)} | 更新: ${new Date(entry.updatedAt).toLocaleString('zh-CN')}
        </div>
        <div style="margin-bottom:12px;display:flex;gap:4px;flex-wrap:wrap;">
          ${(entry.tags || []).map(t => `<span style="font-size:10px;padding:2px 6px;background:var(--bg-subtle);border-radius:4px;">${escapeHtml(t)}</span>`).join('')}
        </div>
        <div style="white-space:pre-wrap;font-size:13px;max-height:400px;overflow:auto;">${escapeHtml(entry.content)}</div>
      `,
            footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">关闭</button>
        <button class="btn btn-danger" id="kb-del-btn">删除</button>
      `
        });
        document.getElementById('kb-del-btn')?.addEventListener('click', async () => {
            if (!await window.Modal.confirm('确定删除？'))
                return;
            try {
                await window.API.deleteKnowledge(entry.id);
                window.Toast.success('已删除');
                window.Modal.close();
                await loadEntries();
            }
            catch (e) {
                window.Toast.error('删除失败: ' + e.message);
            }
        });
    }
    function showExportDialog() {
        window.Modal.open({
            title: '导出知识库',
            body: `
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">选择导出格式：</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid var(--border-subtle);border-radius:6px;cursor:pointer;">
            <input type="radio" name="export-format" value="json" checked>
            <div>
              <div style="font-weight:500;">JSON</div>
              <div style="font-size:11px;color:var(--text-muted);">完整备份，可重新导入</div>
            </div>
          </label>
          <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid var(--border-subtle);border-radius:6px;cursor:pointer;">
            <input type="radio" name="export-format" value="csv">
            <div>
              <div style="font-weight:500;">CSV</div>
              <div style="font-size:11px;color:var(--text-muted);">可用 Excel 打开编辑</div>
            </div>
          </label>
          <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid var(--border-subtle);border-radius:6px;cursor:pointer;">
            <input type="radio" name="export-format" value="markdown">
            <div>
              <div style="font-weight:500;">Markdown</div>
              <div style="font-size:11px;color:var(--text-muted);">可读性好，适合归档查阅</div>
            </div>
          </label>
        </div>
      `,
            footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="export-confirm-btn">导出</button>
      `
        });
        document.getElementById('export-confirm-btn')?.addEventListener('click', async () => {
            const format = document.querySelector('[name="export-format"]:checked')?.value || 'json';
            try {
                const btn = document.getElementById('export-confirm-btn');
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = '导出中...';
                }
                const url = window.API.exportKnowledge(format);
                const key = localStorage.getItem('claude_console_api_key') || '';
                const res = await fetch(url, { headers: { 'X-API-Key': key } });
                if (!res.ok)
                    throw new Error(`导出失败 (${res.status})`);
                const blob = await res.blob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `knowledge-export.${format === 'csv' ? 'csv' : format === 'markdown' ? 'md' : 'json'}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(a.href);
                window.Modal.close();
                window.Toast.success('导出已完成');
            }
            catch (e) {
                window.Toast.error(e.message || '导出失败');
            }
            finally {
                const btn = document.getElementById('export-confirm-btn');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '导出';
                }
            }
        });
    }
    function showImportDialog() {
        window.Modal.open({
            title: '导入知识库',
            body: `
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">
          支持 JSON 和 CSV 格式。JSON 需包含 entries 数组，CSV 需包含 title,content,category,tags 列头。
        </div>
        <div class="form-group">
          <label class="form-label">选择文件</label>
          <input type="file" id="kb-import-file" accept=".json,.csv" style="font-size:13px;">
        </div>
        <div id="kb-import-preview" style="font-size:12px;color:var(--text-muted);margin-top:8px;"></div>
      `,
            footer: `
        <button class="btn btn-secondary" onclick="Modal.close()">取消</button>
        <button class="btn btn-primary" id="import-confirm-btn" disabled>导入</button>
      `
        });
        let parsedEntries = [];
        document.getElementById('kb-import-file')?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const content = ev.target?.result;
                    if (file.name.endsWith('.json')) {
                        const data = JSON.parse(content);
                        parsedEntries = data.entries || data;
                        if (!Array.isArray(parsedEntries))
                            throw new Error('JSON 需包含 entries 数组');
                    }
                    else if (file.name.endsWith('.csv')) {
                        parsedEntries = parseCSV(content);
                    }
                    else {
                        throw new Error('不支持的文件格式');
                    }
                    document.getElementById('kb-import-preview').innerHTML =
                        `解析成功：找到 ${parsedEntries.length} 条知识条目`;
                    document.getElementById('import-confirm-btn').disabled = false;
                }
                catch (err) {
                    document.getElementById('kb-import-preview').innerHTML =
                        `<span style="color:var(--accent-red);">解析失败: ${escapeHtml(err.message)}</span>`;
                    document.getElementById('import-confirm-btn').disabled = true;
                }
            };
            reader.readAsText(file);
        });
        document.getElementById('import-confirm-btn')?.addEventListener('click', async () => {
            if (parsedEntries.length === 0)
                return;
            try {
                const res = await window.API.importKnowledge(parsedEntries);
                window.Toast.success(`成功导入 ${res.data?.imported || 0} 条知识`);
                window.Modal.close();
                await loadEntries();
            }
            catch (e) {
                window.Toast.error('导入失败: ' + e.message);
            }
        });
    }
    function parseCSV(text) {
        const lines = text.replace(/^﻿/, '').split('\n').filter(l => l.trim());
        if (lines.length < 2)
            return [];
        const parseRow = (line) => {
            const result = [];
            let current = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (inQuotes) {
                    if (ch === '"' && line[i + 1] === '"') {
                        current += '"';
                        i++;
                    }
                    else if (ch === '"') {
                        inQuotes = false;
                    }
                    else {
                        current += ch;
                    }
                }
                else {
                    if (ch === '"') {
                        inQuotes = true;
                    }
                    else if (ch === ',') {
                        result.push(current);
                        current = '';
                    }
                    else {
                        current += ch;
                    }
                }
            }
            result.push(current);
            return result;
        };
        const headers = parseRow(lines[0]).map(h => h.trim().toLowerCase());
        const titleIdx = headers.indexOf('title');
        const contentIdx = headers.indexOf('content');
        const categoryIdx = headers.indexOf('category');
        const tagsIdx = headers.indexOf('tags');
        if (titleIdx === -1)
            return [];
        return lines.slice(1).map(line => {
            const cols = parseRow(line);
            return {
                title: cols[titleIdx] || '',
                content: cols[contentIdx] || '',
                category: cols[categoryIdx] || 'imported',
                tags: cols[tagsIdx] ? cols[tagsIdx].split(/[;,]/).map(t => t.trim()).filter(Boolean) : []
            };
        }).filter(e => e.title);
    }
    function debounce(fn, delay) {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
    }
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
    function cleanup() { }
    return { render, cleanup };
})();
