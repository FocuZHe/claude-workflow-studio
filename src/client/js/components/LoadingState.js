window.LoadingState = (() => {
  function render(text = '加载中...') {
    return `
      <div class="loading-container">
        <div class="spinner"></div>
        <div class="loading-text">${text}</div>
      </div>
    `;
  }
  return { render };
})();
