/**
 * WorkflowInteropService - 工作流互操作服务
 * 处理工作流之间的交互，以及工作流的导入/导出（Claude Code .md 格式）
 *
 * .md 格式约定：
 *   ---
 *   description: <描述>
 *   model: <模型>
 *   ---
 *   ## 步骤 1：<标签>
 *   <内容>
 *   ## 步骤 2：<标签>
 *   <内容>
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
    model?: string;
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
     * 从步骤标题行提取 label
     * 支持: "步骤 1：审查" / "步骤 1: 审查" / "1: Review" / "1：Review" / "审查"
     */
    private static _extractLabel;
    /**
     * 解析 Claude Code .md 格式的工作流文件
     * 支持 frontmatter（--- 包裹的 YAML 头）+ ## 步骤
     */
    static parseMarkdown(content: string): ParsedWorkflow;
    /**
     * 将解析后的工作流转换为 DAG（节点和边）
     * 从 parsed.model 设置 agent 节点的 config.model
     */
    static toWorkflowDag(parsed: ParsedWorkflow): {
        nodes: any[];
        edges: any[];
    };
    /**
     * 将工作流导出为 Claude Code .md 格式
     * 生成 frontmatter（description/model）+ ## 步骤 N：label
     */
    static toMarkdown(workflow: any): string;
}
//# sourceMappingURL=WorkflowInteropService.d.ts.map