/**
 * GitService - Git操作服务
 * 提供Git版本控制功能
 */
export interface GitStatus {
    branch: string;
    modified: string[];
    added: string[];
    deleted: string[];
    untracked: string[];
}
export declare class GitService {
    private workspaceRoot;
    constructor(workspaceRoot: string);
    /**
     * 获取Git状态
     */
    getStatus(): Promise<GitStatus>;
    /**
     * 创建Git worktree
     */
    createWorktree(agentId: string): Promise<string>;
    /**
     * 删除Git worktree
     */
    removeWorktree(agentId: string): Promise<void>;
}
//# sourceMappingURL=GitService.d.ts.map