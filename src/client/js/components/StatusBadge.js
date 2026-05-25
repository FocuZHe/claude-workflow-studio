// ═══════════════════════════════════════════════
// StatusBadge Component
// ═══════════════════════════════════════════════

window.StatusBadge = (() => {
  const statusLabels = {
    idle: '空闲',
    busy: '忙碌',
    running: '运行中',
    error: '错误',
    offline: '离线',
    completed: '已完成',
    failed: '失败',
    pending: '等待中',
    cancelled: '已取消',
    draft: '草稿',
    paused: '已暂停',
    waiting_human: '等待人工',
  };

  function render(status) {
    const s = (status || 'idle').toLowerCase();
    const label = statusLabels[s] || s;
    return `<span class="badge badge-${s}"><span class="dot"></span>${label}</span>`;
  }

  return { render };
})();
