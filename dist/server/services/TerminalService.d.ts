/**
 * TerminalService - 真正的 PTY 终端服务
 * 使用 node-pty 创建真实的 shell 进程
 */
export interface TerminalSession {
    id: string;
    name: string;
    status: 'active' | 'inactive';
    cwd: string;
    createdAt: Date;
    cols: number;
    rows: number;
    history: string[];
}
export declare class TerminalService {
    private static sessions;
    private static broadcastService;
    /**
     * 设置广播服务
     */
    static setBroadcastService(bs: any): void;
    /**
     * 获取默认 shell
     */
    private static getDefaultShell;
    /**
     * 创建终端会话（真正的 PTY）
     */
    static createSession(cwd: string, savedData?: any): any;
    /**
     * 获取终端会话
     */
    static getSession(sessionId: string): any;
    /**
     * 获取所有终端会话
     */
    static getSessions(): any[];
    /**
     * 关闭终端会话
     */
    static killSession(sessionId: string): boolean;
    /**
     * 写入输入到 PTY
     */
    static writeInput(sessionId: string, data: string): boolean;
    /**
     * 调整终端大小
     */
    static resizeSession(sessionId: string, cols: number, rows: number): boolean;
    /**
     * 获取输出（PTY 模式下不需要，输出通过 WebSocket 推送）
     */
    static getOutput(sessionId: string): string | null;
    /**
     * 从磁盘加载会话
     */
    static _loadSessionFromDisk(cwd: string): any;
    /**
     * 关闭所有会话
     */
    static killAll(): void;
}
//# sourceMappingURL=TerminalService.d.ts.map