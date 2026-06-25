"use strict";
/**
 * TagService - 标签服务
 * 管理标签系统
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TagService = void 0;
class TagService {
    // _tags 为数组（测试直接赋值清空）
    static _tags = [];
    static workspaceRoot = '';
    /**
     * 初始化
     */
    static init(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    /**
     * 创建标签（重名返回 null，由路由判断 CONFLICT）
     */
    static createTag(name, color) {
        if (!name)
            return null;
        const exists = this._tags.some(t => t.name === name);
        if (exists)
            return null;
        const tag = {
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
    static getTag(tagId) {
        return this._tags.find(t => t.id === tagId);
    }
    /**
     * 获取所有标签
     */
    static getAllTags() {
        return this._tags.slice();
    }
    /**
     * 删除标签
     */
    static deleteTag(tagId) {
        const idx = this._tags.findIndex(t => t.id === tagId);
        if (idx === -1)
            return false;
        this._tags.splice(idx, 1);
        return true;
    }
    // ---- 路由别名（与 knowledge.ts 路由使用的命名一致）----
    static create(name, color) {
        return this.createTag(name, color);
    }
    static list() {
        return this.getAllTags();
    }
    static delete(tagId) {
        return this.deleteTag(tagId);
    }
    static clear() {
        this._tags = [];
    }
}
exports.TagService = TagService;
module.exports = TagService;
//# sourceMappingURL=TagService.js.map