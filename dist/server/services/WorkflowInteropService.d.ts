/**
 * WorkflowInteropService - 工作流互操作服务
 * 处理工作流之间的交互，以及工作流的导入/导出
 */
export interface WorkflowMessage {
    id: string;
    fromWorkflowId: string;
    toWorkflowId: string;
    type: string;
    data: any;
    timestamp: Date;
}
export interface ParsedWorkflow {
    name: string;
    description: string;
    steps: WorkflowStep[];
}
export interface WorkflowStep {
    id: string;
    label: string;
    type: string;
    description: string;
    prompt: string;
}
export declare class WorkflowInteropService {
    private static messages;
    /**
     * 发送消息
     */
    static sendMessage(fromWorkflowId: string, toWorkflowId: string, type: string, data: any): WorkflowMessage;
    /**
     * 获取消息
     */
    static getMessages(workflowId: string): WorkflowMessage[];
    /**
     * 清空消息
     */
    static clearMessages(): void;
    /**
     * 解析 Claude Code .md 格式的工作流文件
     * 支持简单的 markdown 格式，提取标题、步骤和描述
     */
    static parseMarkdown(content: string): ParsedWorkflow;
    /**
     * 将解析后的工作流转换为 DAG（节点和边）
     */
    static toWorkflowDag(parsed: ParsedWorkflow): {
        nodes: any[];
        edges: any[];
    };
    /**
     * 将工作流导出为 Claude Code .md 格式
     */
    static toMarkdown(workflow: any): string;
}
//# sourceMappingURL=WorkflowInteropService.d.ts.map