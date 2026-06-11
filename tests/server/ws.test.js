const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const WebSocket = require('ws');

const { createApp } = require('../../dist/server/app');
const WsServer = require('../../dist/server/ws/server');
const { getApiKey } = require('../../dist/server/middleware/auth');

let server;
let wsUrl;
let wsServer;

/**
 * Create a WebSocket connection and collect messages from the start.
 * Returns { ws, messages, waitForType }
 */
function connectAndCollect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const messages = [];
    const waiting = new Map(); // type -> [resolve, reject, timer]

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        messages.push(msg);

        // Check if anyone is waiting for this type
        const waiters = waiting.get(msg.type);
        if (waiters && waiters.length > 0) {
          const { resolve: wResolve, timer } = waiters.shift();
          clearTimeout(timer);
          wResolve(msg);
        }
      } catch (e) {
        // ignore non-JSON
      }
    });

    ws.on('open', () => {
      resolve({
        ws,
        messages,
        waitForType(type, timeout = 3000) {
          // Check if we already have this message
          const existing = messages.find(m => m.type === type);
          if (existing) return Promise.resolve(existing);

          return new Promise((wResolve, wReject) => {
            const timer = setTimeout(() => {
              wReject(new Error(`Timeout waiting for ${type}`));
            }, timeout);
            if (!waiting.has(type)) waiting.set(type, []);
            waiting.get(type).push({ resolve: wResolve, timer });
          });
        }
      });
    });

    ws.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('WebSocket Server', () => {
  before(async () => {
    const { app, broadcastService } = createApp();
    server = http.createServer(app);
    wsServer = new WsServer(broadcastService);
    wsServer.attach(server);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    wsUrl = `ws://127.0.0.1:${addr.port}/ws?api_key=${getApiKey()}`;
  });

  after(() => { wsServer.close(); return new Promise(resolve => server.close(resolve)); });

  it('should accept connections and send welcome', async () => {
    const { ws, waitForType } = await connectAndCollect();
    assert.strictEqual(ws.readyState, WebSocket.OPEN);

    const msg = await waitForType('welcome');
    assert.ok(msg.payload.clientId);
    assert.ok(msg.payload.message);
    assert.ok(msg.timestamp);

    ws.terminate();
  });

  it('should handle ping and respond with pong', async () => {
    const { ws, waitForType } = await connectAndCollect();
    await waitForType('welcome');

    ws.send(JSON.stringify({ type: 'ping' }));
    const msg = await waitForType('pong');
    assert.strictEqual(msg.type, 'pong');

    ws.terminate();
  });

  it('should handle subscribe and setPage without errors', async () => {
    const { ws, messages, waitForType } = await connectAndCollect();
    await waitForType('welcome');

    ws.send(JSON.stringify({
      type: 'subscribe',
      payload: { channels: ['agents', 'tasks'] }
    }));

    ws.send(JSON.stringify({
      type: 'setPage',
      payload: { page: 'agents' }
    }));

    await sleep(200);

    // Check no error messages were sent
    const errors = messages.filter(m => m.type === 'error');
    assert.strictEqual(errors.length, 0);

    ws.terminate();
  });

  it('should send error for unknown message type', async () => {
    const { ws, waitForType } = await connectAndCollect();
    await waitForType('welcome');

    ws.send(JSON.stringify({ type: 'invalid_type' }));
    const msg = await waitForType('error');
    assert.ok(msg.payload.message.includes('Unknown message type'));

    ws.terminate();
  });

  it('should send error for invalid JSON', async () => {
    const { ws, waitForType } = await connectAndCollect();
    await waitForType('welcome');

    ws.send('not valid json{{{');
    const msg = await waitForType('error');
    assert.ok(msg.payload.message.includes('Invalid JSON'));

    ws.terminate();
  });

  it('should handle unsubscribe without errors', async () => {
    const { ws, messages, waitForType } = await connectAndCollect();
    await waitForType('welcome');

    ws.send(JSON.stringify({
      type: 'subscribe',
      payload: { channels: ['agents'] }
    }));
    await sleep(50);

    ws.send(JSON.stringify({
      type: 'unsubscribe',
      payload: { channels: ['agents'] }
    }));
    await sleep(50);

    const errors = messages.filter(m => m.type === 'error');
    assert.strictEqual(errors.length, 0);

    ws.terminate();
  });

  it('should broadcast client count when clients connect', async () => {
    const client1 = await connectAndCollect();
    await client1.waitForType('welcome');

    // Record how many client.count messages we have so far
    const countBefore = client1.messages.filter(m => m.type === 'client.count').length;

    // Now connect second client - first client should get another client.count
    const client2 = await connectAndCollect();
    await client2.waitForType('welcome');

    // Wait for the new client.count message
    await sleep(200);
    const countMessages = client1.messages.filter(m => m.type === 'client.count');
    assert.ok(countMessages.length > countBefore, 'Should have received a new client.count message');

    const latestCount = countMessages[countMessages.length - 1];
    assert.ok(typeof latestCount.payload.count === 'number');
    assert.ok(latestCount.payload.count >= 2);

    client1.ws.terminate();
    client2.ws.terminate();
  });
});
