/**
 * AgentService - Agent管理服务
 * 管理Agent的创建、更新、删除
 */
export interface Agent {
    id: string;
    name: string;
    description: string;
    model: string;
    systemPrompt: string;
    createdAt: Date;
    updatedAt: Date;
}
export declare class AgentService {
    private static agents;
    private static broadcastService;
    /**
     * 初始化服务
     */
    static init(broadcastService?: any): void;
    /**
     * 创建Agent
     */
    static create(data: any): any;
    /**
     * 获取Agent列表（分页）
     */
    static list(params?: any): any;
    /**
     * 获取所有Agent
     */
    static findAll(): any[];
    /**
     * 获取单个Agent
     */
    static getById(id: string): any;
    /**
     * 获取子Agent
     */
    static getChildren(parentId: string): any[];
    /**
     * 更新Agent
     */
    static update(id: string, data: any): any;
    /**
     * 删除Agent
     */
    static delete(id: string): boolean;
    /**
     * 检查Agent是否存在
     */
    static exists(id: string): boolean;
    /**
     * 获取Agent日志
     */
    static getLogs(id: string, limit?: number): any[];
}
//# sourceMappingURL=AgentService.d.ts.map