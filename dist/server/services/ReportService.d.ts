/**
 * ReportService - 报告服务
 * 生成和管理基于工作流执行历史的报告
 *
 * 存储键：`${workflowId}:${runId}` 复合键
 * Report 对象包含 workflowId/runId/content/createdAt/size 等字段
 */
export interface Report {
    workflowId: string;
    runId: string;
    title: string;
    content: string;
    type: string;
    createdAt: Date;
    size: number;
}
export interface ReportError {
    error: string;
}
export declare class ReportService {
    private static reports;
    private static workspaceRoot;
    /**
     * 初始化
     */
    static init(workspaceRoot: string): void;
    /**
     * 生成复合键
     */
    private static _key;
    /**
     * 生成报告（内部使用，不校验）
     */
    private static _createReport;
    /**
     * 从执行历史生成报告
     * 校验 workflow 存在性 + executionLog 是否有对应 runId
     * 返回 Report 对象或 { error } 对象
     */
    static generateReportFromHistory(workflowId: string, runId: string): Report | ReportError;
    /**
     * 构建 markdown 报告内容（以 "# 工作流执行报告" 开头）
     */
    private static _buildMarkdownReport;
    /**
     * 获取报告（按 workflowId + runId 复合键查询）
     */
    static getReport(workflowId: string, runId: string): Report | undefined;
    /**
     * 获取所有报告
     */
    static getAllReports(): Report[];
    /**
     * 列出报告（带分页和过滤）
     */
    static listReports(workflowId?: string, options?: any): any;
    /**
     * 获取报告元数据
     */
    static getReportMeta(workflowId: string, runId: string): any;
    /**
     * 删除报告
     */
    static deleteReport(workflowId: string, runId: string): boolean;
    /**
     * 清空所有报告（供测试使用）
     */
    static clear(): void;
}
//# sourceMappingURL=ReportService.d.ts.map