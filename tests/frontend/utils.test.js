const { describe, it, expect } = require('@jest/globals');

// 测试 escapeHtml
describe('escapeHtml', () => {
  // 从项目中加载或模拟
  function escapeHtml(str) {
    const d = { textContent: str || '' };
    return d.textContent
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  it('should escape HTML entities', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('should handle empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('should handle null', () => {
    expect(escapeHtml(null)).toBe('');
  });

  it('should handle undefined', () => {
    expect(escapeHtml(undefined)).toBe('');
  });
});

// 测试 debounce
describe('debounce', () => {
  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  it('should delay execution', async () => {
    let called = false;
    const fn = debounce(() => { called = true; }, 100);
    fn();
    expect(called).toBe(false);
    await new Promise(r => setTimeout(r, 150));
    expect(called).toBe(true);
  });

  it('should only execute once for rapid calls', async () => {
    let count = 0;
    const fn = debounce(() => { count++; }, 100);
    fn();
    fn();
    fn();
    await new Promise(r => setTimeout(r, 150));
    expect(count).toBe(1);
  });
});

// 测试 formatSize
describe('formatSize', () => {
  function formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return `${bytes.toFixed(1)} ${units[i]}`;
  }

  it('should format bytes', () => {
    expect(formatSize(500)).toBe('500.0 B');
  });

  it('should format kilobytes', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
  });

  it('should format megabytes', () => {
    expect(formatSize(1048576)).toBe('1.0 MB');
  });

  it('should handle zero', () => {
    expect(formatSize(0)).toBe('0 B');
  });

  it('should handle null', () => {
    expect(formatSize(null)).toBe('0 B');
  });
});
