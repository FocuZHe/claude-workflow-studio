"use strict";
// ═══════════════════════════════════════════════
// State Store — Simple pub/sub
// ═══════════════════════════════════════════════
window.Store = (() => {
    const state = {
        agents: [],
        workflows: [],
        tasks: [],
        clients: { count: 0 },
        currentPage: 'dashboard',
        activeWorkspaces: [],
        activeWorkspaceId: null,
    };
    const subscribers = {};
    function get(key) {
        return state[key];
    }
    function set(key, value) {
        state[key] = value;
        notify(key);
    }
    function update(key, fn) {
        state[key] = fn(state[key]);
        notify(key);
    }
    function setState(partial) {
        for (const [key, value] of Object.entries(partial)) {
            state[key] = value;
        }
        for (const key of Object.keys(partial)) {
            notify(key);
        }
    }
    function subscribe(key, fn) {
        if (!subscribers[key])
            subscribers[key] = [];
        subscribers[key].push(fn);
        return () => {
            subscribers[key] = subscribers[key].filter(f => f !== fn);
        };
    }
    function notify(key) {
        (subscribers[key] || []).forEach(fn => {
            try {
                fn(state[key]);
            }
            catch (e) {
                console.error('[Store]', e);
            }
        });
    }
    function getState() {
        return { ...state };
    }
    return { get, set, update, setState, subscribe, getState };
})();
