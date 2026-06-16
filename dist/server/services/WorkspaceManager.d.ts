/**
 * WorkspaceManager - 工作区管理器
 * 管理多个工作区，支持持久化
 */
declare const EventEmitter: any;
export interface Workspace {
    id: string;
    path: string;
    name: string;
    activatedAt: Date;
    workflowData: any[];
    agentData: any[];
}
export declare class WorkspaceManager extends EventEmitter {
    private static _workspaces;
    private static _initialized;
    /**
     * 初始化（启动时调用，恢复持久化的工作区）
     */
    static init(): void;
    /**
     * 获取所有活跃工作区（返回数组）
     */
    static getActive(): Workspace[];
    /**
     * 获取第一个活跃工作区
     */
    static getFirstActive(): Workspace | null;
    /**
     * 根据路径查找工作区
     */
    static findByPath(wsPath: string | null | undefined): Workspace | undefined;
    /**
     * 获取工作区
     */
    static getById(workspaceId: string): Workspace | undefined;
    /**
     * 获取所有工作区
     */
    static getAll(): Workspace[];
    /**
     * 添加工作区（带持久化）
     */
    static addWorkspace(workspace: Workspace): void;
    /**
     * 激活工作区（如果已存在则更新，否则创建）
     */
    static activate(wsPath: string): Workspace;
    /**
     * 更新工作区文件中的 workspaceId（工作流和聊天记录）
     */
    private static _updateWorkspaceIds;
    /**
     * 删除工作区（带持久化）
     */
    static removeWorkspace(workspaceId: string): boolean;
    /**
     * 获取指定工作区的工作流列表（从文件系统读取，不切换工作区）
     */
    static getWorkflowsForWorkspace(workspaceId: string): any[];
    /**
     * 恢复所有工作区（从持久化文件）
     */
    static restoreAll(): void;
    /**
     * 持久化工作区列表到文件
     */
    static _persist(): void;
    /**
     * 检查工作区是否有效（路径存在）
     */
    static isValid(workspaceId: string): boolean;
    /**
     * 停用工作区
     */
    static deactivate(workspaceId: string): boolean;
    /**
     * 清理无效工作区（路径不存在的）
     */
    static cleanup(): number;
}
export {};
//# sourceMappingURL=WorkspaceManager.d.ts.map