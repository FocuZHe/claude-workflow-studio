// ═══════════════════════════════════════════════
// Toast Component
// ═══════════════════════════════════════════════

window.Toast = (() => {
  let container = null;

  const icons = {
    success: Icon.svg('check', 16),
    error: Icon.svg('error', 16),
    warning: Icon.svg('warning', 16),
    info: Icon.svg('info', 16),
  };

  function ensureContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function show(message, type = 'info', duration = 3000) {
    const c = ensureContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    iconSpan.innerHTML = icons[type] || icons.info;

    const msgSpan = document.createElement('span');
    msgSpan.className = 'toast-message';
    msgSpan.textContent = message;

    toast.appendChild(iconSpan);
    toast.appendChild(msgSpan);
    c.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }

  function success(msg) { show(msg, 'success'); }
  function error(msg) { show(msg, 'error', 5000); }
  function warning(msg) { show(msg, 'warning', 4000); }
  function info(msg) { show(msg, 'info'); }

  return { show, success, error, warning, info };
})();
