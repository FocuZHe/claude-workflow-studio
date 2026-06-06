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
export declare class BroadcastService extends EventEmitter {
    private wss;
    clients: Map<string, ClientInfo>;
    /**
     * 设置 WebSocket 服务器
     */
    setWebSocketServer(wss: WebSocketServer): void;
    /**
     * 添加客户端
     */
    addClient(clientId: string, ws: WebSocket, metadata?: any): void;
    /**
     * 移除客户端
     */
    removeClient(clientId: string): void;
    /**
     * 更新心跳时间
     */
    updateHeartbeat(clientId: string): void;
    /**
     * 更新客户端元数据
     */
    updateClientMetadata(clientId: string, metadata: any): void;
    /**
     * 发送消息给指定客户端
     */
    sendToClient(clientId: string, type: string, data: any): void;
    /**
     * 清理不活跃的客户端
     */
    cleanupStaleClients(): void;
    /**
     * 广播消息给所有连接的客户端
     */
    broadcast(type: string, data: any): void;
    /**
     * 获取连接的客户端数量
     */
    getClientCount(): number;
    /**
     * 关闭所有连接
     */
    close(): void;
}
//# sourceMappingURL=BroadcastService.d.ts.map