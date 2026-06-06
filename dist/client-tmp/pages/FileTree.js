"use strict";
// ═══════════════════════════════════════════════
// FileTree Component
// ═══════════════════════════════════════════════
window.FileTree = (() => {
    function render(entries, level = 0) {
        if (!entries || entries.length === 0)
            return '';
        // Sort: directories first, then files
        const sorted = [...entries].sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory')
                return -1;
            if (a.type !== 'directory' && b.type === 'directory')
                return 1;
            return a.name.localeCompare(b.name);
        });
        return sorted.map((entry) => {
            const indent = level * 16;
            const icon = entry.type === 'directory' ? Icon.svg('folder-plus', 14) : getFileIcon(entry.name);
            const isDir = entry.type === 'directory';
            return `
        <div class="file-tree-item" data-path="${escapeAttr(entry.path)}" data-type="${entry.type}"
             style="padding:4px 8px 4px ${indent + 8}px;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);transition:background 0.1s;"
             onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
          <span style="font-size:14px;flex-shrink:0;">${icon}</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(entry.name)}</span>
        </div>
        ${isDir && entry.children ? `
          <div class="file-tree-children" data-parent="${escapeAttr(entry.path)}">
            ${render(entry.children, level + 1)}
          </div>
        ` : ''}
      `;
        }).join('');
    }
    function bind(container, onSelect, onContextMenu) {
        container.addEventListener('click', (e) => {
            const target = e.target;
            const item = target.closest('.file-tree-item');
            if (!item)
                return;
            const path = item.dataset.path || '';
            const type = item.dataset.type || '';
            // Toggle directory children
            if (type === 'directory') {
                const children = container.querySelector(`.file-tree-children[data-parent="${CSS.escape(path)}"]`);
                if (children) {
                    children.style.display = children.style.display === 'none' ? '' : 'none';
                    const icon = item.querySelector('span:first-child');
                    if (icon)
                        icon.innerHTML = children.style.display === 'none' ? Icon.svg('folder-plus', 14) : Icon.svg('folder-plus', 14);
                }
            }
            // Highlight selected
            container.querySelectorAll('.file-tree-item').forEach((el) => el.style.color = '');
            item.style.color = 'var(--accent-cyan)';
            onSelect(path, type);
        });
        // Right-click context menu
        container.addEventListener('contextmenu', (e) => {
            const mouseEvent = e;
            const target = mouseEvent.target;
            const item = target.closest('.file-tree-item');
            if (!item)
                return;
            mouseEvent.preventDefault();
            const path = item.dataset.path || '';
            const type = item.dataset.type || '';
            // Remove any existing context menu
            const existing = document.querySelector('.file-tree-ctx-menu');
            if (existing)
                existing.remove();
            const menu = document.createElement('div');
            menu.className = 'file-tree-ctx-menu';
            menu.style.cssText = 'position:fixed;z-index:9999;background:var(--bg-elevated,#1b2744);border:1px solid var(--border-subtle);border-radius:6px;padding:4px 0;min-width:140px;box-shadow:0 4px 16px rgba(0,0,0,0.3);';
            const items = [
                { label: '复制路径', action: 'copyPath' },
                { label: '重命名', action: 'rename' },
                { label: '删除', action: 'delete' },
            ];
            items.forEach(({ label, action }) => {
                const menuItem = document.createElement('div');
                menuItem.textContent = label;
                menuItem.style.cssText = 'padding:6px 16px;font-size:12px;color:var(--text-secondary);cursor:pointer;';
                menuItem.addEventListener('mouseover', () => menuItem.style.background = 'var(--bg-hover,rgba(255,255,255,0.08))');
                menuItem.addEventListener('mouseout', () => menuItem.style.background = 'transparent');
                menuItem.addEventListener('click', () => {
                    menu.remove();
                    if (onContextMenu)
                        onContextMenu(action, path, type);
                });
                menu.appendChild(menuItem);
            });
            // Position near cursor
            menu.style.left = mouseEvent.clientX + 'px';
            menu.style.top = mouseEvent.clientY + 'px';
            document.body.appendChild(menu);
            // Close on click elsewhere
            const closeMenu = (ev) => {
                if (!menu.contains(ev.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            };
            setTimeout(() => document.addEventListener('click', closeMenu), 0);
        });
    }
    function getFileIcon(name) {
        return Icon.svg('files', 14);
    }
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
    function escapeAttr(str) {
        return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }
    return { render, bind };
})();
