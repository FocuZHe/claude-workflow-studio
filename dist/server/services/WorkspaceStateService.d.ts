/**
 * WorkspaceStateService - 工作区状态服务
 * 管理工作区状态持久化（WORKFLOWS 目录下各 JSON 文件）
 *
 * saveState(workspacePath, key, data) —— 按文件 key 异步（debounced）写入
 *   key 与文件名映射见 STATE_FILE_MAP
 * loadState(workspacePath) —— 读取所有相关 JSON 并合并为单一 state 对象
 */
export interface WorkspaceState {
    workspaceId: string;
    path?: string;
    name?: string;
    workspacePath?: string;
    workflows?: any[];
    agents?: any[];
    tasks?: any[];
    skills?: any[];
    mcpTools?: any[];
    executionLog?: any[];
    chatSessions?: any[];
    taskQueues?: any[];
    promptTemplates?: any[];
    manifest?: any;
    knowledge?: any[];
    tags?: any[];
    artifactIndex?: any[];
    createdAt?: Date;
    updatedAt?: Date;
}
export declare class WorkspaceStateService {
    private static states;
    /** saveState debounce 定时器，key = `${workspacePath}|${stateKey}` */
    private static saveTimers;
    private static readonly SAVE_DEBOUNCE_MS;
    /**
     * 确保工作流文件夹存在，并创建所有必要的目录和默认 JSON 文件
     * 按照架构文档要求创建完整的目录结构
     */
    static ensureWorkflowsFolder(workspacePath: string): void;
    /**
     * 加载工作区完整状态
     * 读取 WORKFLOWS/ 下所有相关 JSON 文件并合并为单一 state 对象
     */
    static loadState(workspacePath: string): WorkspaceState | null;
    /**
     * 保存工作区某个状态 key 到对应 JSON 文件（debounced 500ms）
     * 支持两种调用签名：
     *   saveState(workspacePath, key, data)  ← 推荐用法，写入磁盘
     *   saveState(state: WorkspaceState)     ← 兼容旧用法，仅写入内存 states Map
     */
    static saveState(workspacePathOrState: string | WorkspaceState, key?: string, data?: any): void;
    /**
     * 强制 flush 所有 pending 的 saveState（用于测试或关闭时）
     */
    static flushPendingSaves(): void;
    /**
     * 获取内存中的 state（与磁盘 loadState 不同）
     */
    static getState(workspaceId: string): WorkspaceState | undefined;
    /**
     * 获取历史记录
     */
    static getHistory(): WorkspaceState[];
    /**
     * 更新历史记录（内存）
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