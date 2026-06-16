/**
 * WorkspaceStateService - 工作区状态服务
 * 管理工作区状态持久化
 */
export interface WorkspaceState {
    workspaceId: string;
    path?: string;
    name?: string;
    workspacePath?: string;
    workflows?: any[];
    agents?: any[];
    manifest?: any;
    createdAt?: Date;
    updatedAt?: Date;
}
export declare class WorkspaceStateService {
    private static states;
    /**
     * 确保工作流文件夹存在，并创建所有必要的目录和文件
     * 按照架构文档要求创建完整的目录结构
     */
    static ensureWorkflowsFolder(workspacePath: string): void;
    /**
     * 加载状态
     */
    static loadState(workspacePath: string): WorkspaceState | null;
    /**
     * 保存状态
     */
    static saveState(state: WorkspaceState): void;
    /**
     * 获取状态
     */
    static getState(workspaceId: string): WorkspaceState | undefined;
    /**
     * 获取历史记录
     */
    static getHistory(): WorkspaceState[];
    /**
     * 更新历史记录
     */
    static updateHistory(workspacePath: string): void;
    /**
     * 备份工作流文件夹
     */
    static backupWorkflowsFolder(workspacePath: string): void;
    /**
     * 恢复工作流文件夹
     */
    static restoreWorkflowsFolder(workspacePath: string): boolean;
}
//# sourceMappingURL=WorkspaceStateService.d.ts.map