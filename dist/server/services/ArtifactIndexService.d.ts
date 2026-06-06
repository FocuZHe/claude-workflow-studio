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
export declare class ArtifactIndexService {
    private static artifacts;
    private static workspaceRoot;
    /**
     * 索引数组（供路由直接访问）
     */
    static _index: any[];
    /**
     * 初始化
     */
    static init(workspaceRoot: string): void;
    /**
     * 添加产物
     */
    static addArtifact(name: string, type: string, path: string, size: number): Artifact;
    /**
     * 获取产物
     */
    static getArtifact(artifactId: string): Artifact | undefined;
    /**
     * 获取所有产物
     */
    static getAllArtifacts(): Artifact[];
    /**
     * 删除产物
     */
    static deleteArtifact(artifactId: string): boolean;
    /**
     * 搜索产物索引
     */
    static search(query?: string, options?: {
        workflowId?: string;
        type?: string;
        page?: number;
        limit?: number;
    }): any;
    /**
     * 重建索引
     */
    static reindex(workspaceRoot: string): number;
    /**
     * 从索引中删除
     */
    static remove(id: string): boolean;
}
//# sourceMappingURL=ArtifactIndexService.d.ts.map