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

export class ReportService {
  private static reports: Map<string, Report> = new Map();
  private static workspaceRoot: string = '';

  /**
   * 初始化
   */
  static init(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * 生成报告
   */
  static generateReport(title: string, content: string, type: string): Report {
    const report: Report = {
      id: Math.random().toString(36).substring(7),
      title,
      content,
      type,
      createdAt: new Date()
    };

    this.reports.set(report.id, report);
    return report;
  }

  /**
   * 获取报告
   */
  static getReport(reportId: string): Report | undefined {
    return this.reports.get(reportId);
  }

  /**
   * 获取所有报告
   */
  static getAllReports(): Report[] {
    return Array.from(this.reports.values());
  }

  /**
   * 列出报告（带分页和过滤）
   */
  static listReports(workflowId?: string, options: any = {}): any {
    let reports = Array.from(this.reports.values());

    if (workflowId) {
      reports = reports.filter(r => r.id.startsWith(workflowId));
    }

    const { page = 1, limit = 20 } = options;
    const total = reports.length;
    const start = (page - 1) * limit;
    const paginated = reports.slice(start, start + limit);

    return {
      items: paginated,
      total,
      page,
      limit
    };
  }

  /**
   * 从执行历史生成报告
   */
  static generateReportFromHistory(workflowId: string, runId: string): Report {
    const title = `工作流 ${workflowId} 执行报告`;
    const content = `工作流执行完成，Run ID: ${runId}`;
    return this.generateReport(title, content, 'workflow');
  }

  /**
   * 获取报告元数据
   */
  static getReportMeta(workflowId: string, runId: string): any {
    return {
      workflowId,
      runId,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 删除报告
   */
  static deleteReport(workflowId: string, runId: string): boolean {
    // 查找并删除匹配的报告
    for (const [id, report] of this.reports.entries()) {
      if (id.startsWith(workflowId)) {
        this.reports.delete(id);
        return true;
      }
    }
    return false;
  }
}

module.exports = ReportService;
