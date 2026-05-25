window.ConfirmDialog = (() => {
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function show(options = {}) {
    const {
      title = '确认操作',
      message = '确定要执行此操作吗？',
      details = '',
      confirmText = '确定',
      cancelText = '取消',
      danger = false,
    } = options;

    return new Promise(resolve => {
      Modal.open({
        title,
        body: `
          <div style="padding:8px 0;">
            <div style="font-size:14px;color:var(--text-primary);margin-bottom:${details ? '12px' : '0'};">${escapeHtml(message)}</div>
            ${details ? `<div style="font-size:12px;color:var(--text-tertiary);background:var(--bg-subtle);padding:12px;border-radius:var(--border-radius-md);">${escapeHtml(details)}</div>` : ''}
          </div>
        `,
        footer: `
          <button class="btn btn-secondary" id="confirm-cancel-btn">${cancelText}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok-btn">${confirmText}</button>
        `
      });

      document.getElementById('confirm-ok-btn')?.addEventListener('click', () => {
        Modal.close();
        resolve(true);
      });

      document.getElementById('confirm-cancel-btn')?.addEventListener('click', () => {
        Modal.close();
        resolve(false);
      });
    });
  }

  return { show };
})();
