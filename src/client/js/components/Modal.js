"use strict";
// ═══════════════════════════════════════════════
// Modal Component
// ═══════════════════════════════════════════════
window.Modal = (() => {
    let overlay = null;
    let onCloseCallback = null;
    function escapeAttr(str) {
        return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function escapeHtml(str) {
        if (!str)
            return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function ensureOverlay() {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.id = 'modal-overlay';
            document.body.appendChild(overlay);
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay)
                    close();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && overlay.classList.contains('active')) {
                    close();
                }
            });
        }
        return overlay;
    }
    function open({ title, body, footer, onClose }) {
        onCloseCallback = onClose || null;
        const el = ensureOverlay();
        el.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">${escapeHtml(title || '')}</h3>
          <button class="modal-close" id="modal-close-btn">${Icon.svg('close', 16)}</button>
        </div>
        <div class="modal-body">${body || ''}</div>
        ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
      </div>
    `;
        // Force reflow for animation
        el.offsetHeight;
        el.classList.add('active');
        el.querySelector('#modal-close-btn').addEventListener('click', close);
    }
    function close() {
        if (overlay) {
            overlay.classList.remove('active');
            if (onCloseCallback)
                onCloseCallback();
        }
    }
    function setContent({ title, body, footer }) {
        if (!overlay)
            return;
        if (title)
            overlay.querySelector('.modal-title').innerHTML = title;
        if (body)
            overlay.querySelector('.modal-body').innerHTML = body;
        if (footer !== undefined) {
            const footerEl = overlay.querySelector('.modal-footer');
            if (footer) {
                if (footerEl) {
                    footerEl.innerHTML = footer;
                }
                else {
                    const modal = overlay.querySelector('.modal');
                    modal.insertAdjacentHTML('beforeend', `<div class="modal-footer">${footer}</div>`);
                }
            }
            else if (footerEl) {
                footerEl.remove();
            }
        }
    }
    /**
     * Show a styled confirmation dialog.
     * @param title - Dialog title
     * @param message - Confirmation message
     * @param danger - If true, message text is shown in red
     * @returns true if confirmed, false if cancelled
     */
    function confirm(title, message, danger = false) {
        return new Promise((resolve) => {
            let settled = false;
            const settle = (value) => {
                if (settled)
                    return;
                settled = true;
                resolve(value);
            };
            const textColor = danger ? 'var(--accent-red)' : 'var(--text-secondary)';
            open({
                title,
                body: `<div style="font-size:13px;color:${textColor};line-height:1.6;">${escapeHtml(message)}</div>`,
                footer: `
          <button class="btn btn-secondary" id="modal-confirm-cancel">取消</button>
          <button class="btn btn-danger" id="modal-confirm-ok">确认</button>
        `,
                onClose: () => settle(false),
            });
            document.getElementById('modal-confirm-cancel').addEventListener('click', () => {
                settle(false);
                close();
            });
            document.getElementById('modal-confirm-ok').addEventListener('click', () => {
                settle(true);
                close();
            });
        });
    }
    /**
     * Show a styled prompt dialog.
     * @param title - Dialog title
     * @param message - Prompt message
     * @param defaultValue - Default input value
     * @returns entered value, or null if cancelled
     */
    function prompt(title, message, defaultValue = '') {
        return new Promise((resolve) => {
            let settled = false;
            const settle = (value) => {
                if (settled)
                    return;
                settled = true;
                resolve(value);
            };
            open({
                title,
                body: `
          <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:12px;">${escapeHtml(message)}</div>
          <input type="text" id="modal-prompt-input" class="form-input" value="${escapeAttr(defaultValue)}"
                 style="width:100%;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:4px;background:var(--bg-deep);color:var(--text-primary);font-size:13px;">
        `,
                footer: `
          <button class="btn btn-secondary" id="modal-prompt-cancel">取消</button>
          <button class="btn btn-primary" id="modal-prompt-ok">确认</button>
        `,
                onClose: () => settle(null),
            });
            const input = document.getElementById('modal-prompt-input');
            if (input) {
                input.focus();
                input.select();
            }
            document.getElementById('modal-prompt-cancel').addEventListener('click', () => {
                settle(null);
                close();
            });
            document.getElementById('modal-prompt-ok').addEventListener('click', () => {
                const value = input ? input.value : null;
                settle(value);
                close();
            });
        });
    }
    return { open, close, setContent, confirm, prompt };
})();
