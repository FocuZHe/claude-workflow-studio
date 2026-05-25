// ═══════════════════════════════════════════════
// SPA Router — Hash-based
// ═══════════════════════════════════════════════

window.Router = (() => {
  const routes = {};
  let currentRoute = null;
  const beforeEachHooks = [];
  let beforeLeaveGuard = null;
  let _navSeq = 0;
  let _restoring = false; // prevent hashchange loop during guard rejection

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
    // Prevent re-entry from hash restoration
    if (_restoring) return;

    const path = getCurrentPath();
    const handler = routes[path];
    if (!handler) {
      navigate('/dashboard');
      return;
    }

    // Capture a sequence number — only the latest navigation "wins"
    const seq = ++_navSeq;

    // Check before-leave guard
    if (beforeLeaveGuard && currentRoute !== path) {
      const ok = await beforeLeaveGuard(path);
      // Guard ran asynchronously — a newer navigation may have started
      if (seq !== _navSeq) return;
      if (!ok) {
        _restoring = true;
        window.location.hash = currentRoute || '/dashboard';
        // Reset after a tick so the hashchange won't re-enter
        setTimeout(() => { _restoring = false; }, 0);
        return;
      }
    }

    // Another navigation started while we were awaiting — abort
    if (seq !== _navSeq) return;

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
