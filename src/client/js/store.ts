// ═══════════════════════════════════════════════
// State Store — Simple pub/sub
// ═══════════════════════════════════════════════

interface StoreState {
  agents: any[];
  workflows: any[];
  tasks: any[];
  clients: { count: number };
  currentPage: string;
  activeWorkspaces: any[];
  activeWorkspaceId: string | null;
  [key: string]: any;
}

type SubscriberFn = (value: any) => void;

interface StoreAPI {
  get(key: string): any;
  set(key: string, value: any): void;
  update(key: string, fn: (prev: any) => any): void;
  setState(partial: Record<string, any>): void;
  subscribe(key: string, fn: SubscriberFn): () => void;
  getState(): StoreState;
}

(window as any).Store = ((): StoreAPI => {
  const state: StoreState = {
    agents: [],
    workflows: [],
    tasks: [],
    clients: { count: 0 },
    currentPage: 'dashboard',
    activeWorkspaces: [],
    activeWorkspaceId: null,
  };

  const subscribers: Record<string, SubscriberFn[]> = {};

  function get(key: string): any {
    return state[key];
  }

  function set(key: string, value: any): void {
    state[key] = value;
    notify(key);
  }

  function update(key: string, fn: (prev: any) => any): void {
    state[key] = fn(state[key]);
    notify(key);
  }

  function setState(partial: Record<string, any>): void {
    for (const [key, value] of Object.entries(partial)) {
      state[key] = value;
    }
    for (const key of Object.keys(partial)) {
      notify(key);
    }
  }

  function subscribe(key: string, fn: SubscriberFn): () => void {
    if (!subscribers[key]) subscribers[key] = [];
    subscribers[key].push(fn);
    return () => {
      subscribers[key] = subscribers[key].filter(f => f !== fn);
    };
  }

  function notify(key: string): void {
    (subscribers[key] || []).forEach(fn => {
      try { fn(state[key]); } catch (e) { console.error('[Store]', e); }
    });
  }

  function getState(): StoreState {
    return { ...state };
  }

  return { get, set, update, setState, subscribe, getState };
})();
