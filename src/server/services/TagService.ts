/**
 * TagService - 标签服务
 * 管理标签系统
 */

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: Date;
}

export class TagService {
  // _tags 为数组（测试直接赋值清空）
  static _tags: Tag[] = [];
  private static workspaceRoot: string = '';

  /**
   * 初始化
   */
  static init(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * 创建标签（重名返回 null，由路由判断 CONFLICT）
   */
  static createTag(name: string, color: string): Tag | null {
    if (!name) return null;
    const exists = this._tags.some(t => t.name === name);
    if (exists) return null;

    const tag: Tag = {
      id: Math.random().toString(36).substring(2, 10),
      name,
      color: color || '#cccccc',
      createdAt: new Date()
    };

    this._tags.push(tag);
    return tag;
  }

  /**
   * 获取标签
   */
  static getTag(tagId: string): Tag | undefined {
    return this._tags.find(t => t.id === tagId);
  }

  /**
   * 获取所有标签
   */
  static getAllTags(): Tag[] {
    return this._tags.slice();
  }

  /**
   * 删除标签
   */
  static deleteTag(tagId: string): boolean {
    const idx = this._tags.findIndex(t => t.id === tagId);
    if (idx === -1) return false;
    this._tags.splice(idx, 1);
    return true;
  }

  // ---- 路由别名（与 knowledge.ts 路由使用的命名一致）----

  static create(name: string, color: string): Tag | null {
    return this.createTag(name, color);
  }

  static list(): Tag[] {
    return this.getAllTags();
  }

  static delete(tagId: string): boolean {
    return this.deleteTag(tagId);
  }

  static clear(): void {
    this._tags = [];
  }
}

module.exports = TagService;
