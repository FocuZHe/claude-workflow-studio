"use strict";
// ═══════════════════════════════════════════════
// Client-side Cache — TTL-based Map cache
// ═══════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
window.Cache = (() => {
    const _cache = new Map();
    const _ttl = 5 * 60 * 1000; // 5 minutes default TTL
    function set(key, value, ttl = _ttl) {
        _cache.set(key, {
            value,
            expires: Date.now() + ttl
        });
    }
    function get(key) {
        const item = _cache.get(key);
        if (!item)
            return null;
        if (Date.now() > item.expires) {
            _cache.delete(key);
            return null;
        }
        return item.value;
    }
    function has(key) {
        return get(key) !== null;
    }
    function remove(key) {
        _cache.delete(key);
    }
    function clear() {
        _cache.clear();
    }
    async function getOrFetch(key, fetchFn, ttl = _ttl) {
        const cached = get(key);
        if (cached)
            return cached;
        const value = await fetchFn();
        set(key, value, ttl);
        return value;
    }
    return { set, get, has, remove, clear, getOrFetch };
})();
//# sourceMappingURL=cache.js.map