/**
 * KnowledgeService - 知识库服务
 * 管理知识库条目，支持本地持久化
 */
export interface KnowledgeEntry {
    id: string;
    title: string;
    content: string;
    category: string;
    tags: string[];
    source: string;
    createdAt: Date;
    updatedAt: Date;
}
export declare class KnowledgeService {
    static _index: KnowledgeEntry[];
    private static _initialized;
    private static _persistPath;
    /**
     * 初始化服务，加载持久化数据
     */
    static init(workspacePath: string): void;
    /**
     * 从磁盘加载数据
     */
    private static _load;
    /**
     * 持久化到磁盘
     */
    private static _persist;
    /**
     * 添加知识条目
     */
    static addEntry(title: string, content: string, category: string, tags?: string[], source?: string): KnowledgeEntry;
    /**
     * 更新知识条目
     */
    static updateEntry(entryId: string, updates: Partial<KnowledgeEntry>): KnowledgeEntry | null;
    /**
     * 删除知识条目
     */
    static deleteEntry(entryId: string): boolean;
    /**
     * 获取知识条目
     */
    static getEntry(entryId: string): KnowledgeEntry | undefined;
    /**
     * 搜索知识条目（支持 query/category/tag/page/limit，返回 { items, total }）
     */
    static search(query: string, options?: {
        category?: string;
        tag?: string;
        page?: number;
        limit?: number;
    }): {
        items: KnowledgeEntry[];
        total: number;
    };
    /**
     * 获取所有知识条目
     */
    static getAll(): KnowledgeEntry[];
    /**
     * 清空（用于工作区切换）
     */
    static clear(): void;
    /**
     * 重新加载数据
     */
    static reload(entries: KnowledgeEntry[]): void;
    /**
     * 添加条目（兼容路由调用，从 body 提取字段）
     */
    static add(data: any): KnowledgeEntry;
    /**
     * 更新条目（兼容路由调用）
     */
    static update(entryId: string, data: any): KnowledgeEntry | null;
    /**
     * 删除条目（兼容路由调用）
     */
    static delete(entryId: string): boolean;
}
//# sourceMappingURL=KnowledgeService.d.ts.map