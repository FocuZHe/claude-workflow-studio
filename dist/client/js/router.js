"use strict";
// ═══════════════════════════════════════════════
// SPA Router — Hash-based
// ═══════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
window.Router = (() => {
    const routes = {};
    let currentRoute = null;
    const beforeEachHooks = [];
    let beforeLeaveGuard = null;
    let _navSeq = 0;
    let _restoring = false;
    function register(path, handler) {
        routes[path] = handler;
    }
    function navigate(path) {
        window.location.hash = path;
    }
    function getCurrentPath() {
        return window.location.hash.slice(1) || '/dashboard';
    }
    function setBeforeLeave(fn) {
        beforeLeaveGuard = fn;
    }
    async function resolve() {
        if (_restoring)
            return;
        const path = getCurrentPath();
        const handler = routes[path];
        if (!handler) {
            navigate('/dashboard');
            return;
        }
        const seq = ++_navSeq;
        if (beforeLeaveGuard && currentRoute !== path) {
            const ok = await beforeLeaveGuard(path);
            if (seq !== _navSeq)
                return;
            if (!ok) {
                _restoring = true;
                window.location.hash = currentRoute || '/dashboard';
                setTimeout(() => { _restoring = false; }, 0);
                return;
            }
        }
        if (seq !== _navSeq)
            return;
        beforeLeaveGuard = null;
        for (const hook of beforeEachHooks) {
            hook(path, currentRoute);
        }
        currentRoute = path;
        handler();
    }
    function beforeEach(fn) {
        beforeEachHooks.push(fn);
    }
    function init() {
        window.addEventListener('hashchange', () => resolve());
        if (!window.location.hash) {
            window.location.hash = '#/dashboard';
        }
        resolve();
    }
    function getNavSeq() {
        return _navSeq;
    }
    return { register, navigate, getCurrentPath, setBeforeLeave, getNavSeq, beforeEach, init };
})();
//# sourceMappingURL=router.js.map