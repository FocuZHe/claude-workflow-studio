/**
 * AuditService - 审计服务
 * 记录系统审计日志
 */

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string;
  ip: string;
  sensitive: boolean;
}

// 敏感操作列表
const SENSITIVE_ACTIONS = new Set(['DELETE', 'SET_WORKSPACE', 'DROP', 'DESTROY']);

export class AuditService {
  static logs: AuditLogEntry[] = [];

  /**
   * 记录审计日志
   */
  static log(action: string, targetType: string, targetId: string, detail: string, ip: string = ''): AuditLogEntry {
    const entry: AuditLogEntry = {
      id: Math.random().toString(36).substring(7),
      timestamp: new Date().toISOString(),
      action,
      targetType,
      targetId,
      detail,
      ip,
      sensitive: SENSITIVE_ACTIONS.has(action)
    };
    this.logs.push(entry);
    return entry;
  }

  /**
   * 获取审计日志（支持分页和过滤）
   */
  static getLogs(options?: { page?: number; limit?: number; action?: string; targetType?: string; sensitive?: boolean }): { items: AuditLogEntry[]; total: number } {
    let results = [...this.logs];

    if (options?.action) {
      results = results.filter(log => log.action === options.action);
    }
    if (options?.targetType) {
      results = results.filter(log => log.targetType === options.targetType);
    }
    if (options?.sensitive !== undefined) {
      results = results.filter(log => log.sensitive === options.sensitive);
    }

    // 按时间倒序
    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const total = results.length;
    const page = options?.page || 1;
    const limit = options?.limit || 50;
    const start = (page - 1) * limit;
    const items = results.slice(start, start + limit);

    return { items, total };
  }

  /**
   * 清空审计日志
   */
  static clear(): void {
    this.logs = [];
  }

  /**
   * 从磁盘加载审计日志
   */
  static loadFromDisk(): void {
    // 简化实现
  }
}

module.exports = AuditService;
