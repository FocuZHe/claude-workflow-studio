/**
 * BroadcastService - WebSocket 广播服务
 * 用于向所有连接的客户端广播消息
 */

import { WebSocket, WebSocketServer } from 'ws';
import { EventEmitter } from 'events';

export interface BroadcastMessage {
  type: string;
  [key: string]: any;
}

export interface ClientInfo {
  ws: WebSocket;
  metadata: any;
  lastHeartbeat: number;
}

export class BroadcastService extends EventEmitter {
  private wss: WebSocketServer | null = null;
  public clients: Map<string, ClientInfo> = new Map();
  private _history: any[] = [];

  /**
   * 设置 WebSocket 服务器
   */
  setWebSocketServer(wss: WebSocketServer): void {
    this.wss = wss;

    wss.on('connection', (ws: WebSocket) => {
      const clientId = Math.random().toString(36).substring(7);
      this.addClient(clientId, ws, {});

      ws.on('close', () => {
        this.removeClient(clientId);
      });

      ws.on('error', () => {
        this.removeClient(clientId);
      });
    });
  }

  /**
   * 添加客户端
   */
  addClient(clientId: string, ws: WebSocket, metadata: any = {}): void {
    this.clients.set(clientId, {
      ws,
      metadata,
      lastHeartbeat: Date.now()
    });
    // 广播客户端数量变化
    this.broadcast('client.count', { count: this.clients.size });
  }

  /**
   * 移除客户端
   */
  removeClient(clientId: string): void {
    this.clients.delete(clientId);
    // 广播客户端数量变化
    this.broadcast('client.count', { count: this.clients.size });
  }

  /**
   * 更新心跳时间
   */
  updateHeartbeat(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastHeartbeat = Date.now();
    }
  }

  /**
   * 更新客户端元数据
   */
  updateClientMetadata(clientId: string, metadata: any): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.metadata = { ...client.metadata, ...metadata };
    }
  }

  /**
   * 发送消息给指定客户端
   */
  sendToClient(clientId: string, type: string, data: any): void {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify({ type, payload: data, timestamp: new Date().toISOString() }));
      } catch (err) {
        this.clients.delete(clientId);
      }
    }
  }

  /**
   * 清理不活跃的客户端
   */
  cleanupStaleClients(): void {
    const now = Date.now();
    const timeout = 60000; // 60秒

    for (const [clientId, client] of this.clients.entries()) {
      if (now - client.lastHeartbeat > timeout) {
        try {
          client.ws.close();
        } catch (_) {}
        this.clients.delete(clientId);
      }
    }
  }

  /**
   * 广播消息给所有连接的客户端
   */
  broadcast(type: string, data: any): void {
    const message: BroadcastMessage = { type, payload: data };
    const messageStr = JSON.stringify(message);

    this.clients.forEach((client, clientId) => {
      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(messageStr);
        } else {
          this.clients.delete(clientId);
        }
      } catch (err) {
        this.clients.delete(clientId);
      }
    });

    // Also emit as event for local listeners
    this.emit(type, data);
  }

  /**
   * 获取连接的客户端数量
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * 获取所有连接的客户端信息（供 /api/clients 路由使用）
   */
  getClients(): any[] {
    const list: any[] = [];
    this.clients.forEach((client, clientId) => {
      list.push({
        id: clientId,
        metadata: client.metadata || {},
        lastHeartbeat: client.lastHeartbeat ? new Date(client.lastHeartbeat).toISOString() : null
      });
    });
    return list;
  }

  /**
   * 发送广播消息（供 /api/broadcast 路由使用）
   * 返回发送的客户端数量
   */
  broadcastMessage(message: string, type: string = 'info', data?: any): number {
    const payload = {
      message,
      type,
      data: data || null,
      timestamp: new Date().toISOString()
    };
    // 记录到历史
    this._history.unshift(payload);
    if (this._history.length > 100) {
      this._history = this._history.slice(0, 100);
    }
    // 广播给所有客户端
    this.broadcast('broadcast', payload);
    return this.clients.size;
  }

  /**
   * 获取广播历史（供 /api/broadcast/history 路由使用）
   */
  getHistory(limit: number = 50): any[] {
    return this._history.slice(0, limit);
  }

  /**
   * 关闭所有连接
   */
  close(): void {
    this.clients.forEach((client) => {
      try {
        client.ws.close();
      } catch (_) {}
    });
    this.clients.clear();
  }
}

module.exports = BroadcastService;
