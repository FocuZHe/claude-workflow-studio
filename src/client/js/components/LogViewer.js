"use strict";
// ═══════════════════════════════════════════════
// LogViewer Component
// ═══════════════════════════════════════════════
window.LogViewer = (() => {
    let paused = false;
    function render(logs = [], id = 'log-viewer') {
        const btnId = id + '-pause-btn';
        return `
      <div style="display:flex;justify-content:flex-end;padding:4px 0;">
        <button class="btn btn-sm btn-secondary" id="${btnId}" onclick="LogViewer.togglePause('${btnId}')">${paused ? '继续' : '暂停'}</button>
      </div>
      <div class="log-viewer" id="${id}" style="max-height:250px;overflow-y:auto;">
        ${logs.length === 0 ? '<div class="text-muted" style="padding:8px;font-size:12px;">暂无日志</div>' : ''}
        ${logs.map((entry) => renderEntry(entry)).join('')}
      </div>
    `;
    }
    function togglePause(btnId) {
        paused = !paused;
        const btn = document.getElementById(btnId);
        if (btn)
            btn.textContent = paused ? '继续' : '暂停';
    }
    function renderEntry(entry) {
        const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
        return `
      <div class="log-entry">
        <span class="log-timestamp">${ts}</span>
        <span class="log-level ${entry.level || 'info'}">${(entry.level || 'info').toUpperCase()}</span>
        <span class="log-message">${escapeHtml(entry.message || '')}</span>
      </div>
    `;
    }
    function appendLog(containerId, entry) {
        if (paused)
            return;
        const container = document.getElementById(containerId);
        if (!container)
            return;
        const noLogs = container.querySelector('.text-muted');
        if (noLogs)
            noLogs.remove();
        container.insertAdjacentHTML('beforeend', renderEntry(entry));
        container.scrollTop = container.scrollHeight;
    }
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    return { render, appendLog, togglePause };
})();
