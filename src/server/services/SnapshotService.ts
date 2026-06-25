/**
 * SnapshotService - 快照服务
 * 管理工作区/工作流快照，按 workflowId 分组存储
 */

const WorkflowModel = require('../models/Workflow');

export interface Snapshot {
  id: string;
  workflowId: string;
  name: string;
  description: string;
  data: any;
  createdAt: Date;
}

export class SnapshotService {
  // 按 workflowId 分组：workflowId -> snapshotId -> Snapshot
  private static snapshots: Map<string, Map<string, Snapshot>> = new Map();
  private static workspaceRoot: string = '';

  /**
   * 初始化
   */
  static init(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
  }

  private static ensureBucket(workflowId: string): Map<string, Snapshot> {
    let bucket = this.snapshots.get(workflowId);
    if (!bucket) {
      bucket = new Map();
      this.snapshots.set(workflowId, bucket);
    }
    return bucket;
  }

  /**
   * 创建并保存快照（供路由 POST /:id/snapshots 调用）
   * 保存指定工作流的当前状态
   */
  static save(workflowId: string, name?: string): Snapshot {
    const workflow = WorkflowModel.findById(workflowId);
    const snapshot: Snapshot = {
      id: Math.random().toString(36).substring(2, 10),
      workflowId,
      name: name || `Snapshot ${new Date().toLocaleString()}`,
      description: workflow ? `Workflow ${workflow.name}` : '',
      data: workflow ? JSON.parse(JSON.stringify(workflow)) : null,
      createdAt: new Date()
    };
    this.ensureBucket(workflowId).set(snapshot.id, snapshot);
    return snapshot;
  }

  /**
   * 列出指定工作流的所有快照（供路由 GET /:id/snapshots 调用）
   */
  static list(workflowId: string): Snapshot[] {
    const bucket = this.snapshots.get(workflowId);
    if (!bucket) return [];
    return Array.from(bucket.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  /**
   * 从快照恢复工作流（供路由 POST /:id/snapshots/:snapshotId/restore 调用）
   */
  static restore(workflowId: string, snapshotId: string): { restored: boolean; snapshot: Snapshot | null } {
    const bucket = this.snapshots.get(workflowId);
    const snapshot = bucket?.get(snapshotId);
    if (!snapshot || !snapshot.data) {
      return { restored: false, snapshot: null };
    }
    // 将快照数据写回工作流
    try {
      WorkflowModel.update(workflowId, snapshot.data);
      return { restored: true, snapshot };
    } catch (e) {
      return { restored: false, snapshot };
    }
  }

  /**
   * 删除指定快照（供路由 DELETE /:id/snapshots/:snapshotId 调用）
   */
  static delete(workflowId: string, snapshotId: string): boolean {
    const bucket = this.snapshots.get(workflowId);
    if (!bucket) return false;
    return bucket.delete(snapshotId);
  }

  // ---- 兼容旧 API（createSnapshot/getSnapshot/getAllSnapshots/deleteSnapshot）----

  static createSnapshot(name: string, description: string, data: any): Snapshot {
    const snapshot: Snapshot = {
      id: Math.random().toString(36).substring(2, 10),
      workflowId: '',
      name,
      description,
      data,
      createdAt: new Date()
    };
    this.ensureBucket('').set(snapshot.id, snapshot);
    return snapshot;
  }

  static getSnapshot(snapshotId: string): Snapshot | undefined {
    return this.snapshots.get('')?.get(snapshotId);
  }

  static getAllSnapshots(): Snapshot[] {
    const all: Snapshot[] = [];
    for (const bucket of this.snapshots.values()) {
      for (const snap of bucket.values()) all.push(snap);
    }
    return all;
  }

  static deleteSnapshot(snapshotId: string): boolean {
    for (const bucket of this.snapshots.values()) {
      if (bucket.delete(snapshotId)) return true;
    }
    return false;
  }
}

module.exports = SnapshotService;
