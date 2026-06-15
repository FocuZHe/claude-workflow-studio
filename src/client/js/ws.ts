// ═══════════════════════════════════════════════
// WebSocket Client — Auto-reconnect + Heartbeat
// ═══════════════════════════════════════════════

type WSEventHandler = (...args: any[]) => void;

interface WsAPI {
  init(): void;
  send(type: string, payload?: any): boolean;
  on(event: string, fn: WSEventHandler, throttleMs?: number): () => void;
  off(event: string, fn: WSEventHandler): void;
  emit(event: string, ...args: any[]): void;
  isConnected(): boolean;
  disconnect(): void;
}

(window as any).WS = ((): WsAPI => {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectDelay = 1000;
  const maxDelay = 30000;
  const listeners: Record<string, WSEventHandler[]> = {};
  let connected = false;

  let _reconnectAttempts = 0;
  const _maxReconnectAttempts = 10;

  const _throttledHandlers = new Map<WSEventHandler, WSEventHandler>();

  function getUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const key = localStorage.getItem('claude_console_api_key') || '';
    return `${proto}://${location.host}/ws?api_key=${encodeURIComponent(key)}`;
  }

  function connect(): void {
    if (ws && ws.readyState <= 1) return;

    ws = new WebSocket(getUrl());

    ws.onopen = () => {
      const wasReconnect = _reconnectAttempts > 0;
      connected = true;
      reconnectDelay = 1000;
      _reconnectAttempts = 0;
      startHeartbeat();
      emit('_connected');
      send('subscribe', { channels: ['agents', 'tasks', 'workflows', 'logs', 'claude', 'queues', 'terminal', 'chat'] });

      if (wasReconnect) {
        requestStateSync();
      }
    };

    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type) {
          emit(msg.type, msg.payload, msg.timestamp);
        }
      } catch (err) {
        console.warn('[WS] Invalid message:', e.data);
      }
    };

    ws.onclose = (event: CloseEvent) => {
      console.log('[WS] WebSocket disconnected:', event.code);
      connected = false;
      stopHeartbeat();
      emit('_disconnected');

      if (_reconnectAttempts < _maxReconnectAttempts) {
        scheduleReconnect();
      } else {
        console.error('[WS] Max reconnection attempts reached, will retry on page focus');
        // 添加页面焦点事件监听，用户回到页面时自动重连
        const onFocus = () => {
          if (!connected) {
            console.log('[WS] Page focused, attempting reconnection...');
            _reconnectAttempts = 0;
            scheduleReconnect();
          }
        };
        window.addEventListener('focus', onFocus, { once: true });
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  function send(type: string, payload: any = {}): boolean {
    if (!ws || ws.readyState !== 1) {
      console.warn('[WS] Cannot send, connection not open. Message dropped.');
      return false;
    }
    ws.send(JSON.stringify({ type, payload }));
    return true;
  }

  function startHeartbeat(): void {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      send('ping');
    }, 25000);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    const delay = Math.min(reconnectDelay * Math.pow(1.5, _reconnectAttempts), maxDelay);
    console.log(`[WS] Reconnecting in ${Math.round(delay)}ms (attempt ${_reconnectAttempts + 1}/${_maxReconnectAttempts})`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      _reconnectAttempts++;
      connect();
      reconnectDelay = Math.min(reconnectDelay * 1.5, maxDelay);
    }, delay);
  }

  function on(event: string, fn: WSEventHandler, throttleMs: number = 0): () => void {
    if (!listeners[event]) listeners[event] = [];

    if (throttleMs > 0) {
      let lastCall = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const throttledHandler: WSEventHandler = (data: any) => {
        const now = Date.now();
        if (now - lastCall >= throttleMs) {
          lastCall = now;
          fn(data);
        } else {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            lastCall = Date.now();
            fn(data);
          }, throttleMs - (now - lastCall));
        }
      };
      _throttledHandlers.set(fn, throttledHandler);
      listeners[event].push(throttledHandler);
    } else {
      listeners[event].push(fn);
    }
    return () => off(event, fn);
  }

  function off(event: string, fn: WSEventHandler): void {
    if (!listeners[event]) return;
    const throttled = _throttledHandlers.get(fn);
    if (throttled) {
      listeners[event] = listeners[event].filter(f => f !== throttled);
      _throttledHandlers.delete(fn);
    } else {
      listeners[event] = listeners[event].filter(f => f !== fn);
    }
  }

  function emit(event: string, ...args: any[]): void {
    (listeners[event] || []).forEach(fn => {
      try { fn(...args); } catch (e) { console.error('[WS] Listener error:', e); }
    });
  }

  function isConnected(): boolean { return connected; }

  function requestStateSync(): void {
    if (!connected) return;
    window.dispatchEvent(new CustomEvent('ws:reconnected'));
    send('sync_request');
  }

  function disconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    _reconnectAttempts = _maxReconnectAttempts;
    if (ws) {
      ws.close();
    }
  }

  function init(): void {
    connect();
    on('task.completed', (payload: any) => {
      (Toast as any).success(`任务完成: ${payload.taskName || payload.taskId}`);
    });
    on('task.failed', (payload: any) => {
      (Toast as any).error(`任务失败: ${payload.taskName || payload.taskId} - ${payload.error || ''}`);
    });

    on('queue.completed', (payload: any) => {
      (Toast as any).success(`队列已完成: ${payload.queueName || ''}`);
    });
    on('queue.failed', (payload: any) => {
      (Toast as any).error(`队列执行失败: ${payload.queueName || ''}`);
    });
    on('queue.waitingHuman', (payload: any) => {
      (Toast as any).warning(`队列等待人工响应: ${payload.queueName || ''}`);
    });

    on('agent.tool_use', (payload: any) => {
      console.log(`[Agent] 工具调用: ${payload.toolName}`, payload);
    });
    on('agent.tool_result', (payload: any) => {
      console.log(`[Agent] 工具结果: ${payload.toolUseId}`, payload);
    });
    on('agent.tool_executed', (payload: any) => {
      console.log(`[Agent] 工具执行完成: ${payload.toolName}`, payload);
    });
    on('agent.security_check', (payload: any) => {
      console.log(`[Agent] 安全检查: ${payload.toolName}`, payload);
    });
    on('agent.tool_blocked', (payload: any) => {
      (Toast as any).warning(`安全拦截: ${payload.toolName} - ${payload.reason}`);
    });
  }

  return { init, send, on, off, isConnected, emit, disconnect };
})();
