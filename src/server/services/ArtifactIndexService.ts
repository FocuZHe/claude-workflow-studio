/**
 * ArtifactIndexService - 产物索引服务
 * 管理工作区产物索引
 */

export interface Artifact {
  id: string;
  name: string;
  type: string;
  path: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
}

export class ArtifactIndexService {
  private static artifacts: Map<string, Artifact> = new Map();
  private static workspaceRoot: string = '';

  /**
   * 索引数组（供路由直接访问）
   */
  static _index: any[] = [];

  /**
   * 初始化
   */
  static init(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * 添加产物
   */
  static addArtifact(name: string, type: string, path: string, size: number): Artifact {
    const artifact: Artifact = {
      id: Math.random().toString(36).substring(7),
      name,
      type,
      path,
      size,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.artifacts.set(artifact.id, artifact);
    return artifact;
  }

  /**
   * 获取产物
   */
  static getArtifact(artifactId: string): Artifact | undefined {
    return this.artifacts.get(artifactId);
  }

  /**
   * 获取所有产物
   */
  static getAllArtifacts(): Artifact[] {
    return Array.from(this.artifacts.values());
  }

  /**
   * 删除产物
   */
  static deleteArtifact(artifactId: string): boolean {
    return this.artifacts.delete(artifactId);
  }

  /**
   * 搜索产物索引
   */
  static search(query?: string, options?: { workflowId?: string; type?: string; page?: number; limit?: number }): any {
    let items = [...this._index];
    if (query) items = items.filter(a => a.fileName?.toLowerCase().includes(query.toLowerCase()) || a.name?.toLowerCase().includes(query.toLowerCase()));
    if (options?.workflowId) items = items.filter(a => a.workflowId === options.workflowId);
    if (options?.type) items = items.filter(a => a.type === options.type || a.mimeType?.includes(options.type));
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const total = items.length;
    items = items.slice((page - 1) * limit, page * limit);
    return { items, total, page, limit };
  }

  /**
   * 重建索引
   */
  static reindex(workspaceRoot: string): number {
    const fs = require('fs');
    const path = require('path');
    this._index = [];
    this.workspaceRoot = workspaceRoot;

    const walk = (dir: string, rel: string = ''): void => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            walk(fullPath, relPath);
          } else if (entry.isFile()) {
            const stat = fs.statSync(fullPath);
            this._index.push({
              id: Math.random().toString(36).substring(7),
              fileName: entry.name,
              filePath: relPath,
              mimeType: path.extname(entry.name),
              size: stat.size,
              createdAt: stat.birthtime,
              updatedAt: stat.mtime
            });
          }
        }
      } catch (e) { /* skip unreadable dirs */ }
    };

    walk(workspaceRoot);
    return this._index.length;
  }

  /**
   * 从索引中删除
   */
  static remove(id: string): boolean {
    const idx = this._index.findIndex(a => a.id === id);
    if (idx === -1) return false;
    this._index.splice(idx, 1);
    return true;
  }
}

module.exports = ArtifactIndexService;
