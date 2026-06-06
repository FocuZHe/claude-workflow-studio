/**
 * AgentTemplateService - Agent模板服务
 * 管理预设的Agent模板和自定义模板
 */
export interface AgentTemplate {
    id: string;
    name: string;
    role: string;
    description: string;
    model: string;
    agentType: string;
    systemPrompt: string;
    temperature?: number;
    toolPermissions?: string[];
    isBuiltin?: boolean;
    createdAt?: string;
    updatedAt?: string;
}
export declare class AgentTemplateService {
    private static builtinTemplates;
    private static customTemplates;
    /**
     * 获取所有模板（内置 + 自定义）
     */
    static getAll(): AgentTemplate[];
    /**
     * 获取模板
     */
    static getById(templateId: string): AgentTemplate | undefined;
    /**
     * 创建自定义模板
     */
    static create(data: {
        name: string;
        role?: string;
        description?: string;
        model?: string;
        systemPrompt?: string;
        temperature?: number;
        toolPermissions?: string[];
    }): AgentTemplate;
    /**
     * 删除自定义模板
     */
    static delete(templateId: string): boolean;
    /**
     * 清空自定义模板（测试用）
     */
    static clear(): void;
    /**
     * 创建Agent从模板
     */
    static createFromTemplate(templateId: string, data: any): any;
}
//# sourceMappingURL=AgentTemplateService.d.ts.map