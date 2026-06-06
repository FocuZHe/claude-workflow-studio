/**
 * ReportService - 报告服务
 * 生成和管理报告
 */
export interface Report {
    id: string;
    title: string;
    content: string;
    type: string;
    createdAt: Date;
}
export declare class ReportService {
    private static reports;
    private static workspaceRoot;
    /**
     * 初始化
     */
    static init(workspaceRoot: string): void;
    /**
     * 生成报告
     */
    static generateReport(title: string, content: string, type: string): Report;
    /**
     * 获取报告
     */
    static getReport(reportId: string): Report | undefined;
    /**
     * 获取所有报告
     */
    static getAllReports(): Report[];
    /**
     * 列出报告（带分页和过滤）
     */
    static listReports(workflowId?: string, options?: any): any;
    /**
     * 从执行历史生成报告
     */
    static generateReportFromHistory(workflowId: string, runId: string): Report;
    /**
     * 获取报告元数据
     */
    static getReportMeta(workflowId: string, runId: string): any;
    /**
     * 删除报告
     */
    static deleteReport(workflowId: string, runId: string): boolean;
}
//# sourceMappingURL=ReportService.d.ts.map