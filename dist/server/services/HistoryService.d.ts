/**
 * HistoryService - 历史记录服务
 * 管理工作流执行历史记录
 */
export interface HistoryEntry {
    id: string;
    type?: string;
    data?: any;
    runId?: string;
    workflowId?: string;
    workflowName?: string;
    status?: string;
    startedAt?: Date | null;
    completedAt?: Date | null;
    nodeResults?: any[];
    timestamp: Date;
}
export declare class HistoryService {
    private static entries;
    /**
     * 添加历史记录
     */
    static addEntry(type: string, data: any): any;
    /**
     * 获取历史记录
     */
    static getEntries(type?: string): any[];
    /**
     * 清空历史记录
     */
    static clear(): void;
    /**
     * 获取分页历史记录（从 WorkflowModel 读取执行日志）
     */
    static getHistory(params: {
        status?: string;
        workflowName?: string;
        page?: string | number;
        limit?: string | number;
    }): {
        items: any[];
        total: number;
        page: number;
        limit: number;
    };
    /**
     * 获取执行详情
     */
    static getDetail(runId: string): any;
    /**
     * 重放执行
     */
    static replay(runId: string): any;
}
//# sourceMappingURL=HistoryService.d.ts.map