"use strict";
/**
 * BroadcastService - WebSocket 广播服务
 * 用于向所有连接的客户端广播消息
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BroadcastService = void 0;
const ws_1 = require("ws");
const events_1 = require("events");
class BroadcastService extends events_1.EventEmitter {
    wss = null;
    clients = new Map();
    /**
     * 设置 WebSocket 服务器
     */
    setWebSocketServer(wss) {
        this.wss = wss;
        wss.on('connection', (ws) => {
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
    addClient(clientId, ws, metadata = {}) {
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
    removeClient(clientId) {
        this.clients.delete(clientId);
        // 广播客户端数量变化
        this.broadcast('client.count', { count: this.clients.size });
    }
    /**
     * 更新心跳时间
     */
    updateHeartbeat(clientId) {
        const client = this.clients.get(clientId);
        if (client) {
            client.lastHeartbeat = Date.now();
        }
    }
    /**
     * 更新客户端元数据
     */
    updateClientMetadata(clientId, metadata) {
        const client = this.clients.get(clientId);
        if (client) {
            client.metadata = { ...client.metadata, ...metadata };
        }
    }
    /**
     * 发送消息给指定客户端
     */
    sendToClient(clientId, type, data) {
        const client = this.clients.get(clientId);
        if (client && client.ws.readyState === ws_1.WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify({ type, payload: data, timestamp: new Date().toISOString() }));
            }
            catch (err) {
                this.clients.delete(clientId);
            }
        }
    }
    /**
     * 清理不活跃的客户端
     */
    cleanupStaleClients() {
        const now = Date.now();
        const timeout = 60000; // 60秒
        for (const [clientId, client] of this.clients.entries()) {
            if (now - client.lastHeartbeat > timeout) {
                try {
                    client.ws.close();
                }
                catch (_) { }
                this.clients.delete(clientId);
            }
        }
    }
    /**
     * 广播消息给所有连接的客户端
     */
    broadcast(type, data) {
        const message = { type, payload: data, timestamp: new Date().toISOString() };
        const messageStr = JSON.stringify(message);
        this.clients.forEach((client, clientId) => {
            try {
                if (client.ws.readyState === ws_1.WebSocket.OPEN) {
                    client.ws.send(messageStr);
                }
                else {
                    this.clients.delete(clientId);
                }
            }
            catch (err) {
                this.clients.delete(clientId);
            }
        });
        // Also emit as event for local listeners
        this.emit(type, data);
    }
    /**
     * 获取连接的客户端数量
     */
    getClientCount() {
        return this.clients.size;
    }
    /**
     * 关闭所有连接
     */
    close() {
        this.clients.forEach((client) => {
            try {
                client.ws.close();
            }
            catch (_) { }
        });
        this.clients.clear();
    }
}
exports.BroadcastService = BroadcastService;
module.exports = BroadcastService;
//# sourceMappingURL=BroadcastService.js.map