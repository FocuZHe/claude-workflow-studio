/**
 * McpService - MCP工具管理服务
 * 管理Model Context Protocol工具
 */
export interface McpTool {
    id: string;
    name: string;
    category?: string;
    description: string;
    endpoint: string;
    auth?: any;
    config?: Record<string, any>;
    isBuiltin: boolean;
}
interface InstallRecord {
    toolId: string;
    agentId: string;
}
export declare class McpService {
    static tools: Map<string, McpTool>;
    static installRecords: InstallRecord[];
    /**
     * 初始化（不预注册内置工具 —— 测试期望 clear 后列表为空）
     */
    static init(): void;
    /**
     * 获取MCP工具（按工具名/旧 API）
     */
    static getTool(toolName: string): McpTool | undefined;
    /**
     * 获取MCP工具（按 id 或 name）
     */
    static getById(id: string): McpTool | undefined;
    /**
     * 获取Agent的MCP工具（返回带 id 字段的工具数组）
     */
    static getByAgent(agentId: string): McpTool[];
    /**
     * 获取所有MCP工具
     */
    static getAllTools(): McpTool[];
    /**
     * 创建自定义MCP工具（isBuiltin: false）
     */
    static create(data: Partial<McpTool>): McpTool;
    /**
     * 安装 MCP 工具到 Agent
     * - 不校验 toolId 是否预注册（接受市场工具）
     * - 若 toolId 不在 tools map，注册一个最小记录
     * - 已安装返回 CONFLICT
     * - 返回 { mcpId, agentId, installed: true }
     */
    static install(toolId: string, agentId: string, options?: {
        installAll?: boolean;
    }): any;
    /**
     * 若 toolId 未注册，注册一个最小记录（市场工具自动注册）
     */
    private static _ensureToolRegistered;
    /**
     * 从 Agent 卸载 MCP 工具
     * - 返回 { mcpId, agentId, installed: false }
     * - 未安装抛 NOT_FOUND
     */
    static uninstall(toolId: string, agentId: string): any;
    /**
     * 清空所有工具与安装记录（测试用）
     */
    static clear(): void;
}
export {};
//# sourceMappingURL=McpService.d.ts.map