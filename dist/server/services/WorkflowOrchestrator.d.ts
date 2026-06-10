/**
 * WorkflowOrchestrator — 主控状态机与高级协同编排器
 *
 * 基于 100% 纯 SDK 双轨闭环架构：
 * - 主Agent：原生 Anthropic API（仅 call_sub_agent 工具）
 * - 子Agent：Claude Agent SDK（完整工具权限）
 * - TS层：拦截 call_sub_agent，物理执行子Agent
 *
 * 核心优势：
 * - 主Agent被剥夺所有直接工具，只能通过 call_sub_agent 调度
 * - BetaRunnableTool.run 由 TS 层控制，AI 无法跳过或编造结果
 * - 子Agent在隔离的 Git Worktree 中执行
 */
export interface WorkflowNode {
    id: string;
    type: string;
    label?: string;
    agentId?: string;
    agentType?: string;
    defaultPrompt?: string;
    config?: {
        model?: string;
        systemPrompt?: string;
        agentType?: string;
        subWorkflowId?: string;
        workflowId?: string;
        approvalTitle?: string;
        approvalDescription?: string;
    };
    skillNames?: string[];
    status?: string;
    output?: string;
}
export interface WorkflowEdge {
    id?: string;
    source?: string;
    from?: string;
    target?: string;
    to?: string;
    label?: string;
}
export interface Workflow {
    id: string;
    name?: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    folderPath?: string;
    context?: Record<string, any>;
    memoryEnabled?: boolean;
}
export interface CheckpointData {
    completedNodes?: Record<string, {
        status: string;
        output?: string;
    }>;
}
export interface OrchestrationResult {
    success: boolean;
    output: string;
    nodeResults: Map<string, string>;
    error?: string;
}
export declare class WorkflowOrchestrator {
    private anthropic;
    private activeRunners;
    private workspaceRoot;
    private logger;
    private stateStore;
    private stopped;
    private broadcastService;
    private currentWorkflowId;
    private currentRunId;
    private agentLimit;
    private gitLockLimit;
    constructor(workspaceRoot: string, stateStore: WorkflowOrchestrator['stateStore'], logger: WorkflowOrchestrator['logger'], broadcastService?: WorkflowOrchestrator['broadcastService']);
    /**
     * 启动主Agent指挥官（手动消息循环版）
     *
     * 使用稳定的 anthropic.messages.create() API，手动管理 tool_use/tool_result 循环
     * 主Agent仅持有 call_sub_agent 工具，无法直接执行任何操作
     */
    startMasterCommander(userIntent: string, workflow: Workflow, runId?: string): Promise<OrchestrationResult>;
    /**
     * 构建工作流执行指令（支持并行执行）
     */
    private buildWorkflowInstructions;
    /**
     * 推断Agent类型
     */
    private inferAgentType;
    /**
     * 路由到物理进程并执行
     * @param type Agent类型
     * @param prompt 任务描述
     */
    private executeRoutedStep;
    /**
     * 在隔离的 Worktree 中执行子Agent
     */
    private executeStepInWorktree;
    /**
     * 清理所有worktree
     */
    private cleanupAllWorktrees;
    /**
     * 注册事件监听器
     */
    private registerListeners;
    /**
     * 强制关闭所有活跃的子Agent
     */
    shutdownAll(): Promise<void>;
    /**
     * 设置本地环境（Git排除策略）
     */
    private setupLocalEnvironment;
    /**
     * 创建隔离工作区（Git Worktree 或普通目录）
     */
    private createWorktree;
    /**
     * 清理 Git Worktree
     */
    private cleanupWorktree;
    /**
     * 强制清理 Worktree（幂等操作）
     */
    private forcePrune;
    /**
     * 保存编排状态（用于断点恢复）
     */
    private saveOrchestrationState;
    /**
     * 崩溃恢复自检
     */
    recoverFromCrash(): Promise<void>;
}
//# sourceMappingURL=WorkflowOrchestrator.d.ts.map