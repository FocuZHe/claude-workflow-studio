// ═══════════════════════════════════════════════
// Client-side Cache — TTL-based Map cache
// ═══════════════════════════════════════════════

interface CacheEntry {
  value: any;
  expires: number;
}

interface CacheAPI {
  set(key: string, value: any, ttl?: number): void;
  get(key: string): any;
  has(key: string): boolean;
  remove(key: string): void;
  clear(): void;
  getOrFetch(key: string, fetchFn: () => Promise<any>, ttl?: number): Promise<any>;
}

(window as any).Cache = ((): CacheAPI => {
  const _cache = new Map<string, CacheEntry>();
  const _ttl = 5 * 60 * 1000; // 5 minutes default TTL

  function set(key: string, value: any, ttl: number = _ttl): void {
    _cache.set(key, {
      value,
      expires: Date.now() + ttl
    });
  }

  function get(key: string): any {
    const item = _cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expires) {
      _cache.delete(key);
      return null;
    }
    return item.value;
  }

  function has(key: string): boolean {
    return get(key) !== null;
  }

  function remove(key: string): void {
    _cache.delete(key);
  }

  function clear(): void {
    _cache.clear();
  }

  async function getOrFetch(key: string, fetchFn: () => Promise<any>, ttl: number = _ttl): Promise<any> {
    const cached = get(key);
    if (cached) return cached;

    const value = await fetchFn();
    set(key, value, ttl);
    return value;
  }

  return { set, get, has, remove, clear, getOrFetch };
})();
