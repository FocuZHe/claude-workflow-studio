/**
 * SubAgentRunner — 子Agent物理进程与安全管理器
 *
 * 基于 Claude Agent SDK 的 query() 函数，管理子Agent的生命周期：
 * - 进程启动/停止/超时控制
 * - 50ms输出防抖（防止前端渲染卡死）
 * - Session ID 捕获（支持断点恢复）
 * - PreToolUse 安全拦截
 */
import { EventEmitter } from 'events';
export interface AgentTask {
    id: string;
    description: string;
    model?: string;
    worktree: string;
    timeout?: number;
    resumeSessionId?: string;
    systemPrompt?: string;
    skills?: string[];
}
export interface SubAgentConfig {
    id: string;
    name: string;
    baseSystemPrompt: string;
    allowedTools: string[];
    model?: string;
    timeout?: number;
}
export type SubAgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'aborted';
export declare class SubAgentRunner extends EventEmitter {
    id: string;
    private abortController;
    private status;
    private runningPromise?;
    private sessionId?;
    private logDir;
    constructor(id: string, logDir: string);
    /**
     * 启动子Agent执行任务
     * @param task 任务定义
     * @param allowedTools 允许的工具列表
     * @returns 执行结果
     */
    start(task: AgentTask, allowedTools: string[]): Promise<string>;
    /**
     * 强制终止子Agent
     */
    kill(): void;
    /**
     * 获取当前状态
     */
    getStatus(): SubAgentStatus;
    /**
     * 获取会话ID（用于断点恢复）
     */
    getSessionId(): string | undefined;
}
//# sourceMappingURL=SubAgentRunner.d.ts.map