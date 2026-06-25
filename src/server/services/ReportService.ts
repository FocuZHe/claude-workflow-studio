/**
 * ReportService - 报告服务
 * 生成和管理基于工作流执行历史的报告
 *
 * 存储键：`${workflowId}:${runId}` 复合键
 * Report 对象包含 workflowId/runId/content/createdAt/size 等字段
 */

const logger = require('../utils/logger');

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
   * 生成复合键
   */
  private static _key(workflowId: string, runId: string): string {
    return `${workflowId}:${runId}`;
  }

  /**
   * 生成报告（内部使用，不校验）
   */
  private static _createReport(workflowId: string, runId: string, title: string, content: string, type: string): Report {
    const report: Report = {
      workflowId,
      runId,
      title,
      content,
      type,
      createdAt: new Date(),
      size: Buffer.byteLength(content, 'utf-8')
    };
    this.reports.set(this._key(workflowId, runId), report);
    return report;
  }

  /**
   * 从执行历史生成报告
   * 校验 workflow 存在性 + executionLog 是否有对应 runId
   * 返回 Report 对象或 { error } 对象
   */
  static generateReportFromHistory(workflowId: string, runId: string): Report | ReportError {
    try {
      const WorkflowModel = require('../models/Workflow');
      const wf = WorkflowModel.findById(workflowId);
      if (!wf) {
        return { error: `工作流 '${workflowId}' 不存在` };
      }

      // 查找对应的 executionLog
      const logs = Array.isArray(wf.executionLog) ? wf.executionLog : [];
      const log = logs.find((l: any) => l.runId === runId);
      if (!log) {
        return { error: `执行日志 '${runId}' 不存在` };
      }

      // 生成 markdown 报告
      const title = `工作流 ${wf.name || workflowId} 执行报告`;
      const content = this._buildMarkdownReport(wf, log);
      return this._createReport(workflowId, runId, title, content, 'workflow');
    } catch (e: any) {
      logger.error(`generateReportFromHistory 失败: ${e.message}`);
      return { error: `生成报告失败: ${e.message}` };
    }
  }

  /**
   * 构建 markdown 报告内容（以 "# 工作流执行报告" 开头）
   */
  private static _buildMarkdownReport(workflow: any, log: any): string {
    const lines: string[] = [];
    lines.push(`# 工作流执行报告`);
    lines.push('');
    lines.push(`## 基本信息`);
    lines.push(`- 工作流名称: ${workflow.name || '-'}`);
    lines.push(`- 工作流 ID: ${workflow.id || '-'}`);
    lines.push(`- Run ID: ${log.runId || '-'}`);
    if (log.startedAt) lines.push(`- 开始时间: ${new Date(log.startedAt).toISOString()}`);
    if (log.completedAt) lines.push(`- 完成时间: ${new Date(log.completedAt).toISOString()}`);
    lines.push(`- 执行状态: ${log.status || '-'}`);
    lines.push('');
    lines.push(`## 节点执行结果`);
    const nodeResults = Array.isArray(log.nodeResults) ? log.nodeResults : [];
    if (nodeResults.length === 0) {
      lines.push('（无节点结果）');
    } else {
      for (const nr of nodeResults) {
        const nodeId = nr.nodeId || nr.id || '-';
        const status = nr.status || '-';
        lines.push(`- ${nodeId}: ${status}`);
      }
    }
    lines.push('');
    return lines.join('\n');
  }

  /**
   * 获取报告（按 workflowId + runId 复合键查询）
   */
  static getReport(workflowId: string, runId: string): Report | undefined {
    return this.reports.get(this._key(workflowId, runId));
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
      reports = reports.filter(r => r.workflowId === workflowId);
    }

    if (options.search) {
      const q = String(options.search).toLowerCase();
      reports = reports.filter(r =>
        (r.title || '').toLowerCase().includes(q) ||
        (r.content || '').toLowerCase().includes(q)
      );
    }

    const page = options.page || 1;
    const limit = options.limit || 20;
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
   * 获取报告元数据
   */
  static getReportMeta(workflowId: string, runId: string): any {
    const report = this.getReport(workflowId, runId);
    if (report) {
      return {
        workflowId,
        runId,
        title: report.title,
        size: report.size,
        createdAt: report.createdAt,
        generatedAt: new Date().toISOString()
      };
    }
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
    const key = this._key(workflowId, runId);
    if (this.reports.has(key)) {
      this.reports.delete(key);
      return true;
    }
    return false;
  }

  /**
   * 清空所有报告（供测试使用）
   */
  static clear(): void {
    this.reports.clear();
  }
}

module.exports = ReportService;
