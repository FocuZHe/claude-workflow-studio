const { describe, it, expect } = require('@jest/globals');

describe('StatusBadge', () => {
  function renderStatusBadge(status) {
    const config = {
      pending: { color: 'var(--text-muted)', text: '等待中' },
      running: { color: 'var(--accent-cyan)', text: '运行中' },
      completed: { color: 'var(--accent-green)', text: '已完成' },
      failed: { color: 'var(--accent-red)', text: '失败' },
    };
    const cfg = config[status] || config.pending;
    return `<span style="color:${cfg.color}">${cfg.text}</span>`;
  }

  it('should render pending status', () => {
    expect(renderStatusBadge('pending')).toContain('等待中');
  });

  it('should render running status', () => {
    expect(renderStatusBadge('running')).toContain('运行中');
  });

  it('should render completed status', () => {
    expect(renderStatusBadge('completed')).toContain('已完成');
  });

  it('should render failed status', () => {
    expect(renderStatusBadge('failed')).toContain('失败');
  });

  it('should default to pending for unknown status', () => {
    expect(renderStatusBadge('unknown')).toContain('等待中');
  });
});

describe('Cache', () => {
  class Cache {
    constructor() { this._cache = new Map(); }
    set(key, value, ttl = 300000) {
      this._cache.set(key, { value, expires: Date.now() + ttl });
    }
    get(key) {
      const item = this._cache.get(key);
      if (!item) return null;
      if (Date.now() > item.expires) { this._cache.delete(key); return null; }
      return item.value;
    }
    has(key) { return this.get(key) !== null; }
    remove(key) { this._cache.delete(key); }
    clear() { this._cache.clear(); }
  }

  it('should store and retrieve values', () => {
    const cache = new Cache();
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('should return null for missing keys', () => {
    const cache = new Cache();
    expect(cache.get('missing')).toBeNull();
  });

  it('should expire after TTL', async () => {
    const cache = new Cache();
    cache.set('key1', 'value1', 50);
    expect(cache.get('key1')).toBe('value1');
    await new Promise(r => setTimeout(r, 100));
    expect(cache.get('key1')).toBeNull();
  });

  it('should check existence', () => {
    const cache = new Cache();
    expect(cache.has('key1')).toBe(false);
    cache.set('key1', 'value1');
    expect(cache.has('key1')).toBe(true);
  });

  it('should remove entries', () => {
    const cache = new Cache();
    cache.set('key1', 'value1');
    cache.remove('key1');
    expect(cache.get('key1')).toBeNull();
  });

  it('should clear all entries', () => {
    const cache = new Cache();
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.clear();
    expect(cache.get('key1')).toBeNull();
    expect(cache.get('key2')).toBeNull();
  });
});
