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

export class HistoryService {
  private static entries: HistoryEntry[] = [];

  /**
   * 添加历史记录
   */
  static addEntry(type: string, data: any): any {
    const entry = {
      id: Math.random().toString(36).substring(7),
      type,
      data,
      timestamp: new Date()
    };
    this.entries.push(entry);
    return entry;
  }

  /**
   * 获取历史记录
   */
  static getEntries(type?: string): any[] {
    if (type) {
      return this.entries.filter(entry => entry.type === type);
    }
    return this.entries;
  }

  /**
   * 清空历史记录
   */
  static clear(): void {
    this.entries = [];
  }

  /**
   * 获取分页历史记录（从 WorkflowModel 读取执行日志）
   */
  static getHistory(params: { status?: string; workflowName?: string; page?: string | number; limit?: string | number }): { items: any[]; total: number; page: number; limit: number } {
    const WorkflowModel = require('../models/Workflow');
    const workflows = WorkflowModel.getAll ? WorkflowModel.getAll() : [];

    // 收集所有工作流的执行日志
    let allRuns: any[] = [];
    for (const wf of workflows) {
      const logs = wf.executionLog || [];
      for (const log of logs) {
        allRuns.push({
          ...log,
          workflowId: wf.id,
          workflowName: wf.name
        });
      }
    }

    // 过滤
    if (params.status) {
      allRuns = allRuns.filter(r => r.status === params.status);
    }
    if (params.workflowName) {
      const search = (params.workflowName as string).toLowerCase();
      allRuns = allRuns.filter(r => r.workflowName?.toLowerCase().includes(search));
    }

    // 按时间倒序
    allRuns.sort((a, b) => {
      const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return tb - ta;
    });

    const page = parseInt(String(params.page || '1')) || 1;
    const limit = parseInt(String(params.limit || '20')) || 20;
    const total = allRuns.length;
    const items = allRuns.slice((page - 1) * limit, page * limit);

    return { items, total, page, limit };
  }

  /**
   * 获取执行详情
   */
  static getDetail(runId: string): any {
    const WorkflowModel = require('../models/Workflow');
    const workflows = WorkflowModel.getAll ? WorkflowModel.getAll() : [];

    for (const wf of workflows) {
      const logs = wf.executionLog || [];
      const log = logs.find((l: any) => l.runId === runId);
      if (log) {
        return {
          ...log,
          workflowId: wf.id,
          workflowName: wf.name
        };
      }
    }

    const { AppError } = require('../middleware/errorHandler');
    throw new AppError('NOT_FOUND', `History record ${runId} not found`, 404);
  }

  /**
   * 重放执行
   */
  static replay(runId: string): any {
    const detail = this.getDetail(runId);
    return {
      runId: detail.runId,
      workflowId: detail.workflowId,
      workflowName: detail.workflowName,
      context: {
        nodes: detail.nodeResults || [],
        status: detail.status
      }
    };
  }
}

module.exports = HistoryService;
