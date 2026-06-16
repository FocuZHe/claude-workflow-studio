/**
 * Workflow business logic service
 */
import type { BroadcastService } from './BroadcastService';
export interface WorkflowNode {
    id: string;
    type: string;
    label?: string;
    agentId?: string;
    status?: string;
    output?: string;
    startedAt?: string | null;
    completedAt?: string | null;
    defaultPrompt?: string;
    requiresInput?: boolean;
    config?: {
        model?: string;
        systemPrompt?: string;
        [key: string]: any;
    };
    skillNames?: string[];
    logs?: any[];
    error?: string;
}
export interface WorkflowEdge {
    id?: string;
    source?: string;
    from?: string;
    target?: string;
    to?: string;
    label?: string;
}
export interface WorkflowData {
    id: string;
    name?: string;
    description?: string;
    status: string;
    executionStatus: string;
    currentRunId?: string | null;
    folderPath?: string | null;
    workspaceId?: string | null;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    executionLog: ExecutionLogEntry[];
    context?: Record<string, any>;
    error?: string;
    memoryEnabled?: boolean;
    memorySource?: any;
    knowledgeSource?: any;
}
export interface ExecutionLogEntry {
    runId: string;
    startedAt: Date;
    completedAt: Date | null;
    status: string;
    nodeResults: NodeResult[];
}
export interface NodeResult {
    nodeId: string;
    status: string;
    output: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
}
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    hasStart?: boolean;
    hasEnd?: boolean;
}
export interface ValidationError {
    field: string;
    message: string;
}
export interface ApprovalEntry {
    resolve: (value: {
        decision: string;
        comment?: string;
    }) => void;
    reject: (reason: Error) => void;
    timer: NodeJS.Timeout;
    workflowId: string;
    nodeId: string;
}
export interface ExecuteResult {
    runId: string;
    status: string;
}
export interface NodeRegistryEntry {
    label: string;
    model: string;
    toolPermissions: Record<string, boolean>;
    systemPrompt: string;
    rolePrompt: string;
    task: string;
    skills: string[];
    mcp: string[];
}
export interface StepResult {
    nodeId: string;
    input: string;
    output: string;
}
export interface SimulationResult {
    results: Record<string, string>;
    context: Record<string, any>;
}
export interface ExecutionStatusResult {
    workflowId: string;
    runId: string | null;
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
    progress: number;
    nodes: Array<{
        nodeId: string;
        label: string;
        type: string;
        agentId: string | null;
        status: string;
        output: string | null;
        startedAt: string | null;
        completedAt: string | null;
        logs: any[];
    }>;
    edges: Array<{
        source: string;
        target: string;
    }>;
}
export interface BatchExecuteResult {
    runId: string | null;
    status: string;
    input?: any;
    params?: any;
    error?: string;
}
export interface VariablesResult {
    nodes: Record<string, {
        label: string;
        type: string;
        status: string;
        output: string | null;
    }>;
    context: Record<string, any>;
}
export declare class WorkflowService {
    static _broadcastService: BroadcastService | null;
    static _claudeService: any;
    static _pendingApprovals: Map<string, ApprovalEntry>;
    static _currentRunIds: Map<string, string>;
    static _activeOrchestrators: Map<string, {
        shutdownAll: () => Promise<void>;
    }>;
    /**
     * Initialize WorkflowService with dependencies
     */
    static init(broadcastService: BroadcastService, claudeService?: any): void;
    static _usesInjectedTestClaudeService(): boolean;
    static _resolveModel(alias: string): string;
    /**
     * 修复卡在 'running' 的 executionLog 记录
     * 服务器重启后：
     * - 有 checkpoint 的工作流 → 标记为 interrupted（可恢复）
     * - 没有 checkpoint 的 → 标记为 failed
     */
    static fixStaleExecutionLogs(): void;
    /**
     * Phase 3: 崩溃恢复 - 服务器启动时检查中断的工作流
     * 1. 检查 running 状态的工作流，标记为 interrupted
     * 2. 清理残留的 session-store 中的过期任务
     */
    static recoverInterruptedWorkflows(): void;
    /**
     * Reset nodes that were waiting for human intervention when server restarted.
     */
    static resetStuckNodes(): void;
    /**
     * Create a new workflow
     */
    static create(data: Partial<WorkflowData>): WorkflowData;
    /**
     * List workflows
     */
    static list(filters?: Record<string, any>): any;
    /**
     * Get workflow by ID
     */
    static getById(id: string): WorkflowData;
    /**
     * Update workflow with graph validation
     */
    static update(id: string, data: Partial<WorkflowData>): WorkflowData;
    /**
     * Delete workflow
     */
    static delete(id: string): boolean;
    /**
     * Clean up all resources associated with a workflow (memory, checkpoints, snapshots)
     */
    static _cleanupWorkflowResources(workflowId: string): void;
    /**
     * Validate workflow graph integrity
     */
    static validateGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): ValidationResult;
    /**
     * Validate agent references in workflow nodes
     */
    static validateAgentReferences(nodes: WorkflowNode[]): {
        valid: boolean;
        errors: ValidationError[];
    };
    /**
     * Execute workflow - always uses Master Agent mode (native Agent tool collaboration).
     * Returns immediately with runId, execution continues in background.
     */
    static execute(id: string, input?: any, params?: Record<string, any>, nodeInputs?: Record<string, any>): ExecuteResult;
    static _executeWithInjectedClaudeService(workflowId: string, runId: string, input: any, workflow: WorkflowData): Promise<void>;
    /**
     * 带重试的主Agent执行 - 自动处理429等可重试错误
     */
    static _executeMasterAgentWithRetry(workflowId: string, runId: string, input: any, workflow: WorkflowData, maxRetries?: number): Promise<void>;
    /**
     * 解析错误信息，判断是否可重试
     */
    static _parseError(err: Error): {
        type: string;
        message: string;
        retryable: boolean;
    };
    /**
     * 使用 WorkflowOrchestrator（双轨闭环架构）执行工作流
     *
     * 核心优势：
     * - 主Agent使用原生 Anthropic API，仅持有 call_sub_agent 工具
     * - 子Agent使用 Claude Agent SDK，拥有完整工具权限
     * - TS层拦截 call_sub_agent，物理执行子Agent
     * - 主Agent无法"假装干活"，必须通过 call_sub_agent 调度
     */
    static _executeWithOrchestrator(workflowId: string, runId: string, input: any, workflow: WorkflowData): Promise<void>;
    /**
     * 清理子 Agent 启动的服务器进程（端口 8000-8999）
     * 防止端口占用堆积
     *
     * 改进：
     * 1. 在工作流完成/失败时调用
     * 2. 在服务器启动时调用（清理遗留进程）
     * 3. 只清理当前工作区目录下的 node 进程，避免误杀
     */
    static _cleanupSubagentProcesses(workspaceRoot?: string): Promise<void>;
    /**
     * 服务器启动时清理遗留的子 Agent 进程
     * 在 resetStuckNodes 之后调用
     */
    static cleanupStaleSubagentProcesses(): void;
    static _failWorkflow(workflowId: string, runId: string, errorMessage: string): void;
    /**
     * Get list of agent nodes that require user input before execution
     */
    static getRequiredInputs(id: string): Array<{
        nodeId: string;
        label: string;
        defaultPrompt: string;
        agentId: string | null;
    }>;
    /**
     * Save checkpoint files for completed workflow steps
     */
    static _saveCheckpoint(workflowId: string, workspaceRoot: string, nodes: WorkflowNode[], masterOutput: string): void;
    /**
     * Save a single node's checkpoint file
     */
    static _saveNodeCheckpoint(workspaceRoot: string, nodeId: string, { label, output, model, startedAt, error }: {
        label: string;
        output?: string;
        model?: string;
        startedAt?: string;
        error?: string;
    }, workflowId?: string): void;
    /**
     * Load checkpoint data for workflow resumption
     */
    static _loadCheckpoint(workflowId: string, workspaceRoot: string): {
        completedNodes: Record<string, {
            status: string;
            output: string;
        }>;
    } | null;
    static _waitForApproval(workflowId: string, nodeId: string, requestId: string, timeoutMs?: number): Promise<{
        decision: string;
        comment?: string;
    }>;
    /**
     * Resolve a pending approval Promise.
     */
    static handleApprovalDecision(requestId: string, decision: string, comment?: string): boolean;
    /**
     * Single-step execution: execute only one specific node using Master Agent approach.
     */
    static step(workflowId: string, nodeId: string): Promise<StepResult>;
    /**
     * Simulate workflow execution with mock data, without calling real Claude CLI
     */
    static simulate(workflowId: string, mockData?: Record<string, any>): Promise<SimulationResult>;
    /**
     * Generate simulated output for a node without calling Claude CLI
     */
    static _simulateNode(node: WorkflowNode, nodeOutputs: Map<string, string>, workflow: WorkflowData): string;
    /**
     * Test a single node with provided test input using Master Agent approach.
     */
    static testNode(workflowId: string, nodeId: string, testInput: any): Promise<StepResult>;
    /**
     * Get all node outputs and shared context variables for a workflow
     */
    static getVariables(workflowId: string): VariablesResult;
    /**
     * Batch execute a workflow with multiple parameter sets (sequential).
     */
    static batchExecute(workflowId: string, paramsArray: Array<{
        input: any;
        params?: Record<string, any>;
    }>): Promise<BatchExecuteResult[]>;
    /**
     * Resume workflow execution from a checkpoint.
     */
    static resumeFromCheckpoint(workflowId: string, checkpoint: {
        runId: string;
        workflowInput?: any;
    }): ExecuteResult;
    /**
     * Skip a failed node and continue workflow execution.
     */
    static skipNodeAndContinue(workflowId: string, nodeId: string): ExecuteResult & {
        skippedNode: string;
    };
    /**
     * Poll WorkflowModel for executionStatus changes (used by batchExecute).
     */
    static _waitForMasterCompletion(workflowId: string, timeoutMs?: number): Promise<void>;
    /**
     * Stop a running workflow - sets status to stopped and rejects pending promises
     */
    static stop(id: string): Promise<void>;
    /**
     * Broadcast node status update via BroadcastService
     */
    static _broadcastNodeUpdate(workflowId: string, runId: string, nodeId: string): void;
    /**
     * Broadcast workflow status update via BroadcastService
     */
    static _broadcastStatusUpdate(workflowId: string, status: string, runId: string, summary?: string): void;
    /**
     * Calculate execution progress percentage
     */
    static _calculateProgress(workflowId: string): number;
    /**
     * Pause workflow
     */
    static pause(id: string): {
        status: string;
    };
    /**
     * Resume workflow
     */
    static resume(id: string): {
        status: string;
    };
    /**
     * Get workflow execution status (simple)
     */
    static getStatus(id: string): {
        status: string;
        currentNodeId: string | null;
        progress: number;
        runId: string | null;
    };
    /**
     * Set the working folder for a workflow
     */
    static setFolder(id: string, folderPath: string): WorkflowData;
    /**
     * Clear the working folder for a workflow (make it global)
     */
    static clearFolder(id: string): WorkflowData;
    /**
     * Get detailed execution status for a workflow
     */
    static getExecutionStatus(id: string): ExecutionStatusResult;
}
//# sourceMappingURL=WorkflowService.d.ts.map