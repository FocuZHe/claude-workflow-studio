"use strict";
/**
 * TagService - 标签服务
 * 管理标签系统
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TagService = void 0;
class TagService {
    static tags = new Map();
    static workspaceRoot = '';
    /**
     * 初始化
     */
    static init(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    /**
     * 创建标签
     */
    static createTag(name, color) {
        const tag = {
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
    static getTag(tagId) {
        return this.tags.get(tagId);
    }
    /**
     * 获取所有标签
     */
    static getAllTags() {
        return Array.from(this.tags.values());
    }
    /**
     * 删除标签
     */
    static deleteTag(tagId) {
        return this.tags.delete(tagId);
    }
}
exports.TagService = TagService;
module.exports = TagService;
//# sourceMappingURL=TagService.js.map