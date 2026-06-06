// ═══════════════════════════════════════════════
// SPA Router — Hash-based
// ═══════════════════════════════════════════════

type RouteHandler = () => void;
type BeforeEachHook = (path: string, prevPath: string | null) => void;
type BeforeLeaveGuard = (nextPath: string) => Promise<boolean> | boolean;

interface RouterAPI {
  register(path: string, handler: RouteHandler): void;
  navigate(path: string): void;
  getCurrentPath(): string;
  setBeforeLeave(fn: BeforeLeaveGuard | null): void;
  getNavSeq(): number;
  beforeEach(fn: BeforeEachHook): void;
  init(): void;
}

(window as any).Router = ((): RouterAPI => {
  const routes: Record<string, RouteHandler> = {};
  let currentRoute: string | null = null;
  const beforeEachHooks: BeforeEachHook[] = [];
  let beforeLeaveGuard: BeforeLeaveGuard | null = null;
  let _navSeq = 0;
  let _restoring = false;

  function register(path: string, handler: RouteHandler): void {
    routes[path] = handler;
  }

  function navigate(path: string): void {
    window.location.hash = path;
  }

  function getCurrentPath(): string {
    return window.location.hash.slice(1) || '/dashboard';
  }

  function setBeforeLeave(fn: BeforeLeaveGuard | null): void {
    beforeLeaveGuard = fn;
  }

  async function resolve(): Promise<void> {
    if (_restoring) return;

    const path = getCurrentPath();
    const handler = routes[path];
    if (!handler) {
      navigate('/dashboard');
      return;
    }

    const seq = ++_navSeq;

    if (beforeLeaveGuard && currentRoute !== path) {
      const ok = await beforeLeaveGuard(path);
      if (seq !== _navSeq) return;
      if (!ok) {
        _restoring = true;
        window.location.hash = currentRoute || '/dashboard';
        setTimeout(() => { _restoring = false; }, 0);
        return;
      }
    }

    if (seq !== _navSeq) return;

    beforeLeaveGuard = null;
    for (const hook of beforeEachHooks) {
      hook(path, currentRoute);
    }
    currentRoute = path;
    handler();
  }

  function beforeEach(fn: BeforeEachHook): void {
    beforeEachHooks.push(fn);
  }

  function init(): void {
    window.addEventListener('hashchange', () => resolve());
    if (!window.location.hash) {
      window.location.hash = '#/dashboard';
    }
    resolve();
  }

  function getNavSeq(): number {
    return _navSeq;
  }

  return { register, navigate, getCurrentPath, setBeforeLeave, getNavSeq, beforeEach, init };
})();
