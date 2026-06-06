/**
 * SnapshotService - 快照服务
 * 管理工作区快照
 */
export interface Snapshot {
    id: string;
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
    /**
     * 创建快照
     */
    static createSnapshot(name: string, description: string, data: any): Snapshot;
    /**
     * 获取快照
     */
    static getSnapshot(snapshotId: string): Snapshot | undefined;
    /**
     * 获取所有快照
     */
    static getAllSnapshots(): Snapshot[];
    /**
     * 删除快照
     */
    static deleteSnapshot(snapshotId: string): boolean;
}
//# sourceMappingURL=SnapshotService.d.ts.map