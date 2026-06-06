/**
 * McpService - MCP工具管理服务
 * 管理Model Context Protocol工具
 */
export interface McpTool {
    name: string;
    description: string;
    endpoint: string;
    config: Record<string, any>;
}
export declare class McpService {
    private static tools;
    /**
     * 初始化MCP工具
     */
    static init(): void;
    /**
     * 获取MCP工具
     */
    static getTool(toolName: string): McpTool | undefined;
    /**
     * 获取Agent的MCP工具
     */
    static getByAgent(agentId: string): McpTool[];
    /**
     * 获取所有MCP工具
     */
    static getAllTools(): McpTool[];
}
//# sourceMappingURL=McpService.d.ts.map