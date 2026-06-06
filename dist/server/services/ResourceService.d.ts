/**
 * ResourceService - 资源管理服务
 * 管理工作区资源
 */
export interface Resource {
    id: string;
    name: string;
    type: string;
    path: string;
    size: number;
    createdAt: Date;
    updatedAt: Date;
}
export declare class ResourceService {
    private static resources;
    /**
     * 添加资源
     */
    static addResource(name: string, type: string, path: string, size: number): Resource;
    /**
     * 获取资源
     */
    static getResource(resourceId: string): Resource | undefined;
    /**
     * 获取所有资源
     */
    static getAllResources(): Resource[];
    /**
     * 删除资源
     */
    static deleteResource(resourceId: string): boolean;
    /**
     * 获取系统资源统计
     */
    private static _lastCpuSample;
    static getStats(): Promise<any>;
    /**
     * 获取Agent进程信息
     */
    static getAgentProcesses(): Promise<any[]>;
}
//# sourceMappingURL=ResourceService.d.ts.map