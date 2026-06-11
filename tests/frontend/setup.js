// 模拟浏览器 API
global.localStorage = {
  store: {},
  getItem(key) { return this.store[key] || null; },
  setItem(key, value) { this.store[key] = String(value); },
  removeItem(key) { delete this.store[key]; },
  clear() { this.store = {}; },
};

global.sessionStorage = { ...global.localStorage };

// 模拟 fetch
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  })
);

// 模拟 WebSocket
global.WebSocket = jest.fn(() => ({
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  send: jest.fn(),
  close: jest.fn(),
}));

// 模拟 Notification
global.Notification = {
  permission: 'granted',
  requestPermission: jest.fn(() => Promise.resolve('granted')),
};
