// MCP Market — removed (placeholder MCP tools eliminated)
window.McpMarket = (() => {
  function render() {
    const el = document.getElementById('market-content');
    if (el) el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);">MCP 工具市场已移除。MCP 工具通过 Claude Code CLI 全局配置管理。</div>';
  }
  return { render };
})();
