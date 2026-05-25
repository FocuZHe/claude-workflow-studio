window.EmptyState = (() => {
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function render(options = {}) {
    const { icon = Icon.svg('info', 48), title = '暂无数据', description = '', actionText = '', actionRoute = '', actionId = '' } = options;
    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    const safeActionText = escapeHtml(actionText);
    const btnAttrs = actionId
      ? `id="${escapeHtml(actionId)}"`
      : (actionRoute ? `onclick="Router.navigate('${escapeHtml(actionRoute)}')"` : '');
    return `
      <div class="empty-state">
        <div class="empty-icon">${icon}</div>
        <div class="empty-title">${safeTitle}</div>
        ${description ? `<div class="empty-desc">${safeDescription}</div>` : ''}
        ${actionText ? `<button class="btn btn-primary" ${btnAttrs}>${safeActionText}</button>` : ''}
      </div>
    `;
  }
  return { render };
})();
