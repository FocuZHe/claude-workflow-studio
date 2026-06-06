"use strict";
/**
 * SnapshotService - 快照服务
 * 管理工作区快照
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SnapshotService = void 0;
class SnapshotService {
    static snapshots = new Map();
    static workspaceRoot = '';
    /**
     * 初始化
     */
    static init(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    /**
     * 创建快照
     */
    static createSnapshot(name, description, data) {
        const snapshot = {
            id: Math.random().toString(36).substring(7),
            name,
            description,
            data,
            createdAt: new Date()
        };
        this.snapshots.set(snapshot.id, snapshot);
        return snapshot;
    }
    /**
     * 获取快照
     */
    static getSnapshot(snapshotId) {
        return this.snapshots.get(snapshotId);
    }
    /**
     * 获取所有快照
     */
    static getAllSnapshots() {
        return Array.from(this.snapshots.values());
    }
    /**
     * 删除快照
     */
    static deleteSnapshot(snapshotId) {
        return this.snapshots.delete(snapshotId);
    }
}
exports.SnapshotService = SnapshotService;
module.exports = SnapshotService;
//# sourceMappingURL=SnapshotService.js.map