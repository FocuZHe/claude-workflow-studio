"use strict";
// ═══════════════════════════════════════════════
// Shared Utilities
// ═══════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Escape HTML special characters to prevent XSS.
 * Safe for use in innerHTML contexts.
 */
function escapeHtml(str) {
    if (str == null)
        return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
}
/**
 * Debounce a function call.
 */
function debounce(fn, ms) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}
/**
 * Throttle a function call (at most once per interval).
 */
function throttle(fn, ms) {
    let last = 0;
    let timer;
    return function (...args) {
        const now = Date.now();
        const remaining = ms - (now - last);
        clearTimeout(timer);
        if (remaining <= 0) {
            last = now;
            fn.apply(this, args);
        }
        else {
            timer = setTimeout(() => {
                last = Date.now();
                fn.apply(this, args);
            }, remaining);
        }
    };
}
/**
 * Format a date/time string to locale time.
 */
function formatTime(dateStr) {
    if (!dateStr)
        return '--';
    try {
        return new Date(dateStr).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    catch {
        return dateStr;
    }
}
/**
 * Format a date string to locale date.
 */
function formatDate(dateStr) {
    if (!dateStr)
        return '--';
    try {
        return new Date(dateStr).toLocaleDateString('zh-CN');
    }
    catch {
        return dateStr;
    }
}
/**
 * Render a "load more" button if there are more items to fetch.
 */
function renderLoadMoreButton(currentTotal, totalCount, buttonId = 'load-more-btn') {
    if (currentTotal >= totalCount)
        return '';
    return `
    <div style="text-align:center;padding:16px;">
      <button class="btn btn-secondary" id="${buttonId}">
        加载更多 (${currentTotal}/${totalCount})
      </button>
    </div>
  `;
}
/**
 * Bind click handler to a load-more button (if it exists in the DOM).
 */
function bindLoadMoreButton(buttonId, loadFn) {
    const btn = document.getElementById(buttonId);
    if (btn) {
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = '加载中...';
            try {
                await loadFn();
            }
            finally {
                // Button will be re-rendered by the caller
            }
        });
    }
}
window.Icon = (() => {
    function svg(name, size) {
        size = size || 16;
        return `<svg class="icon icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="icons.svg#icon-${name}"/></svg>`;
    }
    return { svg };
})();
//# sourceMappingURL=utils.js.map