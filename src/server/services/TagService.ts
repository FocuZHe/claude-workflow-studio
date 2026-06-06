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
  private static tags: Map<string, Tag> = new Map();
  private static workspaceRoot: string = '';

  /**
   * 初始化
   */
  static init(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * 创建标签
   */
  static createTag(name: string, color: string): Tag {
    const tag: Tag = {
      id: Math.random().toString(36).substring(7),
      name,
      color,
      createdAt: new Date()
    };

    this.tags.set(tag.id, tag);
    return tag;
  }

  /**
   * 获取标签
   */
  static getTag(tagId: string): Tag | undefined {
    return this.tags.get(tagId);
  }

  /**
   * 获取所有标签
   */
  static getAllTags(): Tag[] {
    return Array.from(this.tags.values());
  }

  /**
   * 删除标签
   */
  static deleteTag(tagId: string): boolean {
    return this.tags.delete(tagId);
  }
}

module.exports = TagService;
