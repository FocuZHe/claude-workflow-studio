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
export declare class TagService {
    static _tags: Tag[];
    private static workspaceRoot;
    /**
     * 初始化
     */
    static init(workspaceRoot: string): void;
    /**
     * 创建标签（重名返回 null，由路由判断 CONFLICT）
     */
    static createTag(name: string, color: string): Tag | null;
    /**
     * 获取标签
     */
    static getTag(tagId: string): Tag | undefined;
    /**
     * 获取所有标签
     */
    static getAllTags(): Tag[];
    /**
     * 删除标签
     */
    static deleteTag(tagId: string): boolean;
    static create(name: string, color: string): Tag | null;
    static list(): Tag[];
    static delete(tagId: string): boolean;
    static clear(): void;
}
//# sourceMappingURL=TagService.d.ts.map