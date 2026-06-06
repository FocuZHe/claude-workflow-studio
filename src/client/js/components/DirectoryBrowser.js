"use strict";
window.DirectoryBrowser = (() => {
    let currentPath = '';
    let selectedPath = '';
    let onConfirmCallback = null;
    let onCancelCallback = null;
    /**
     * Open directory browser dialog
     * @param options
     * @param options.title - Dialog title
     * @param options.onConfirm - Confirm callback (selectedPath) => void
     * @param options.onCancel - Cancel callback
     */
    function open(options) {
        currentPath = '';
        selectedPath = '';
        onConfirmCallback = options.onConfirm || null;
        onCancelCallback = options.onCancel || null;
        Modal.open({
            title: options.title || '选择目录',
            body: renderBody(),
            footer: renderFooter(),
            onClose: () => {
                if (onCancelCallback)
                    onCancelCallback();
            },
        });
        bindEvents();
        loadDirectory('/');
    }
    function renderBody() {
        return `
      <div class="dir-browser">
        <div class="dir-breadcrumb" id="dir-breadcrumb"></div>
        <div class="dir-list" id="dir-list">
          <div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">
            <span class="spinner spinner-sm"></span> 加载中...
          </div>
        </div>
        <div class="dir-create-folder" style="margin-top:12px;display:flex;gap:8px;align-items:center;">
          <input class="input" id="dir-new-folder-name" placeholder="新文件夹名称" style="flex:1;">
          <button class="btn btn-sm btn-secondary" id="dir-create-folder-btn">创建</button>
        </div>
      </div>
    `;
    }
    function renderFooter() {
        return `
      <button class="btn btn-secondary" id="dir-cancel-btn">取消</button>
      <button class="btn btn-primary" id="dir-confirm-btn" disabled>选择此目录</button>
    `;
    }
    function bindEvents() {
        const confirmBtn = document.getElementById('dir-confirm-btn');
        const cancelBtn = document.getElementById('dir-cancel-btn');
        const createBtn = document.getElementById('dir-create-folder-btn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                if (onConfirmCallback)
                    onConfirmCallback(selectedPath);
                Modal.close();
            });
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                Modal.close();
            });
        }
        if (createBtn) {
            createBtn.addEventListener('click', createFolder);
        }
        // Handle enter key in folder name input
        const nameInput = document.getElementById('dir-new-folder-name');
        if (nameInput) {
            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter')
                    createFolder();
            });
        }
    }
    async function loadDirectory(path) {
        const listEl = document.getElementById('dir-list');
        const breadcrumbEl = document.getElementById('dir-breadcrumb');
        if (!listEl)
            return;
        // Show loading
        listEl.innerHTML = `
      <div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">
        <span class="spinner spinner-sm"></span> 加载中...
      </div>
    `;
        try {
            const res = await API.browseDirectories(path);
            const data = res.data || {};
            currentPath = data.currentPath || '';
            selectedPath = currentPath;
            // Update breadcrumb
            if (breadcrumbEl) {
                breadcrumbEl.innerHTML = renderBreadcrumb(currentPath);
                bindBreadcrumbEvents(breadcrumbEl);
            }
            // Update list
            const directories = data.directories || [];
            const parentPath = data.parentPath;
            let html = '';
            // Parent directory (..)
            if (parentPath !== null && parentPath !== undefined) {
                html += `
          <div class="dir-item" data-path="${escapeAttr(parentPath)}" data-action="navigate">
            <span class="dir-item-icon">${Icon.svg('files', 16)}</span>
            <span class="dir-item-name">..</span>
          </div>
        `;
            }
            if (directories.length === 0 && (parentPath === null || parentPath === undefined)) {
                html += `
          <div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">
            此目录为空
          </div>
        `;
            }
            directories.forEach((dir) => {
                html += `
          <div class="dir-item" data-path="${escapeAttr(dir.path)}" data-action="navigate">
            <span class="dir-item-icon">${Icon.svg('files', 16)}</span>
            <span class="dir-item-name">${escapeHtml(dir.name)}</span>
          </div>
        `;
            });
            listEl.innerHTML = html;
            // Bind click events
            listEl.querySelectorAll('.dir-item').forEach((el) => {
                el.addEventListener('click', () => {
                    const action = el.dataset.action;
                    const dirPath = el.dataset.path;
                    if (action === 'navigate') {
                        loadDirectory(dirPath);
                    }
                });
            });
            // Update confirm button
            updateConfirmButton();
        }
        catch (e) {
            const errorMsg = e.message || '加载目录失败';
            listEl.innerHTML = `
        <div style="padding:16px;text-align:center;color:var(--accent-red);font-size:13px;">
          ${escapeHtml(errorMsg)}
        </div>
      `;
        }
    }
    function renderBreadcrumb(dirPath) {
        // Always show "此电脑" link at the start (navigates to system drives)
        let html = `<span class="dir-breadcrumb-item" data-path="/" style="cursor:pointer;">此电脑</span>`;
        if (!dirPath) {
            return html;
        }
        // Normalize separators
        const normalized = dirPath.replace(/\\/g, '/');
        const parts = normalized.split('/').filter(Boolean);
        let accumulated = '';
        parts.forEach((part, i) => {
            if (i === 0 && /^[A-Za-z]:$/.test(part)) {
                // Windows drive letter
                accumulated = part + '/';
            }
            else {
                accumulated += (accumulated ? '/' : '') + part;
            }
            html += ` <span class="dir-breadcrumb-separator">/</span> <span class="dir-breadcrumb-item" data-path="${escapeAttr(accumulated)}">${escapeHtml(part)}</span>`;
        });
        return html;
    }
    function bindBreadcrumbEvents(container) {
        container.querySelectorAll('.dir-breadcrumb-item').forEach((el) => {
            el.addEventListener('click', () => {
                loadDirectory(el.dataset.path);
            });
        });
    }
    function updateConfirmButton() {
        const confirmBtn = document.getElementById('dir-confirm-btn');
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = selectedPath ? `选择此目录 (${selectedPath || '/'})` : '选择此目录 (根目录)';
        }
    }
    async function createFolder() {
        const nameInput = document.getElementById('dir-new-folder-name');
        if (!nameInput)
            return;
        const name = nameInput.value.trim();
        if (!name) {
            Toast.warning('请输入文件夹名称');
            return;
        }
        // Validate folder name
        if (/[\/\\:*?"<>|]/.test(name)) {
            Toast.warning('文件夹名称包含非法字符');
            return;
        }
        try {
            const fullPath = currentPath ? `${currentPath.replace(/[/\\]$/, '')}/${name}` : name;
            await API.mkdir(fullPath);
            Toast.success('文件夹已创建');
            nameInput.value = '';
            // Reload current directory
            await loadDirectory(currentPath);
        }
        catch (e) {
            Toast.error(e.message || '创建文件夹失败');
        }
    }
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
    function escapeAttr(str) {
        return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    return { open };
})();
