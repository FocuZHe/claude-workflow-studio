export interface GitFileStatus {
    path: string;
    status: string;
    staged: boolean;
}
export interface GitStatus {
    branch: string;
    modified: string[];
    added: string[];
    deleted: string[];
    untracked: string[];
    files: GitFileStatus[];
}
export declare class GitService {
    private workspaceRoot;
    constructor(workspaceRoot: string);
    private static runGit;
    static isGitRepo(cwd: string): Promise<boolean>;
    static getStatus(cwd: string): Promise<GitStatus>;
    static getDiff(cwd: string, file?: string): Promise<string>;
    static getLog(cwd: string, limit?: number): Promise<string>;
    static getBranches(cwd: string): Promise<string[]>;
    static commit(cwd: string, message: string, files?: string[]): Promise<string>;
    static checkout(cwd: string, branch: string): Promise<string>;
    static createBranch(cwd: string, name: string): Promise<string>;
    static stageFile(cwd: string, file: string): Promise<string>;
    static unstageFile(cwd: string, file: string): Promise<string>;
    getStatus(): Promise<GitStatus>;
    createWorktree(agentId: string): Promise<string>;
    removeWorktree(agentId: string): Promise<void>;
}
//# sourceMappingURL=GitService.d.ts.map