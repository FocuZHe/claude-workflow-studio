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
export declare class AuditService {
    static logs: AuditLogEntry[];
    /**
     * 记录审计日志
     */
    static log(action: string, targetType: string, targetId: string, detail: string, ip?: string): AuditLogEntry;
    /**
     * 获取审计日志（支持分页和过滤）
     */
    static getLogs(options?: {
        page?: number;
        limit?: number;
        action?: string;
        targetType?: string;
        sensitive?: boolean;
    }): {
        items: AuditLogEntry[];
        total: number;
    };
    /**
     * 清空审计日志
     */
    static clear(): void;
    /**
     * 从磁盘加载审计日志
     */
    static loadFromDisk(): void;
}
//# sourceMappingURL=AuditService.d.ts.map