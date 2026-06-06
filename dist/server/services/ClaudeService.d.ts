/**
 * ClaudeService - 使用 Claude CLI 实现子Agent管理
 * 通过 spawn 子进程调用 Claude CLI
 *
 */
import { EventEmitter } from 'events';
import type { BroadcastService } from './BroadcastService';
export interface ClaudeServiceConfig {
    systemPrompt?: string;
    model?: string;
    folderPath?: string;
    workingDir?: string;
    timeoutMs?: number;
    workflowId?: string;
    nodeId?: string;
    runId?: string;
    executableNodes?: any[];
    nodeRegistry?: Record<string, any>;
    onNodeComplete?: (nodeId: string, label: string, output: string) => void;
}
export interface ClaudeServiceResult {
    text: string;
    error: any;
}
export declare class ClaudeService extends EventEmitter {
    private broadcastService;
    private activeProcesses;
    private _taskWorkflowMap;
    private _taskMetaMap;
    constructor(broadcastService: BroadcastService);
    /**
     * 执行 Claude CLI 任务
     */
    execute(taskId: string, agentId: string | null, prompt: string, config?: ClaudeServiceConfig): Promise<string>;
    /**
     * 内部执行方法
     */
    private _executeInternal;
    /**
     * 广播流式输出块
     */
    private _broadcastChunk;
    /**
     * 取消执行
     */
    cancel(taskId: string): boolean;
    /**
     * 获取活跃进程数
     */
    getActiveCount(): number;
}
//# sourceMappingURL=ClaudeService.d.ts.map