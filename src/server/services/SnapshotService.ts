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

export class SnapshotService {
  private static snapshots: Map<string, Snapshot> = new Map();
  private static workspaceRoot: string = '';

  /**
   * 初始化
   */
  static init(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * 创建快照
   */
  static createSnapshot(name: string, description: string, data: any): Snapshot {
    const snapshot: Snapshot = {
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
  static getSnapshot(snapshotId: string): Snapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  /**
   * 获取所有快照
   */
  static getAllSnapshots(): Snapshot[] {
    return Array.from(this.snapshots.values());
  }

  /**
   * 删除快照
   */
  static deleteSnapshot(snapshotId: string): boolean {
    return this.snapshots.delete(snapshotId);
  }
}

module.exports = SnapshotService;
