/**
 * SnapshotService - 快照服务
 * 管理工作区/工作流快照，按 workflowId 分组存储
 */
export interface Snapshot {
    id: string;
    workflowId: string;
    name: string;
    description: string;
    data: any;
    createdAt: Date;
}
export declare class SnapshotService {
    private static snapshots;
    private static workspaceRoot;
    /**
     * 初始化
     */
    static init(workspaceRoot: string): void;
    private static ensureBucket;
    /**
     * 创建并保存快照（供路由 POST /:id/snapshots 调用）
     * 保存指定工作流的当前状态
     */
    static save(workflowId: string, name?: string): Snapshot;
    /**
     * 列出指定工作流的所有快照（供路由 GET /:id/snapshots 调用）
     */
    static list(workflowId: string): Snapshot[];
    /**
     * 从快照恢复工作流（供路由 POST /:id/snapshots/:snapshotId/restore 调用）
     */
    static restore(workflowId: string, snapshotId: string): {
        restored: boolean;
        snapshot: Snapshot | null;
    };
    /**
     * 删除指定快照（供路由 DELETE /:id/snapshots/:snapshotId 调用）
     */
    static delete(workflowId: string, snapshotId: string): boolean;
    static createSnapshot(name: string, description: string, data: any): Snapshot;
    static getSnapshot(snapshotId: string): Snapshot | undefined;
    static getAllSnapshots(): Snapshot[];
    static deleteSnapshot(snapshotId: string): boolean;
}
//# sourceMappingURL=SnapshotService.d.ts.map