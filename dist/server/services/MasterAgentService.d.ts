/**
 * MasterAgentService — 将所有工作流转换为 Claude Code 原生多 Agent 协作模式
 *
 * 无论节点类型，均用一个主 claude 进程 + Agent 工具 / 原生能力实现，
 * 子 Agent 共享同一工作区，文件互见。
 *
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
        pattern?: string;
        condition?: string;
        trueLabel?: string;
        falseLabel?: string;
        subWorkflowId?: string;
        workflowId?: string;
        approvalTitle?: string;
        approvalDescription?: string;
    };
    skillNames?: string[];
    status?: string;
    output?: string;
    startedAt?: string;
    completedAt?: string;
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
    memorySource?: {
        type: string;
        workflowId?: string;
    };
    knowledgeSource?: {
        type: string;
        entryIds?: string[];
        category?: string;
    };
}
export interface CheckpointData {
    completedNodes?: Record<string, {
        status: string;
        output?: string;
    }>;
}
export interface AgentTypeConfig {
    name: string;
    description: string;
}
export declare class MasterAgentService {
    static canUseMasterAgent(workflow: Workflow | null): boolean;
    static buildSystemPrompt(workflow: Workflow, userInput: string, workingDir: string, checkpointData?: CheckpointData | null): string;
}
//# sourceMappingURL=MasterAgentService.d.ts.map