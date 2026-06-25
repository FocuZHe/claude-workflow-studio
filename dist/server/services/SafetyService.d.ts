/**
 * SafetyService - 安全服务
 * 管理系统安全规则
 */
export interface SafetyRule {
    id: string;
    name: string;
    type: string;
    enabled: boolean;
    config: Record<string, any>;
}
export interface ThreatRecord {
    ip: string;
    type: string;
    pattern: string;
    severity: string;
    description: string;
    url: string;
    method: string;
    timestamp: string;
}
export declare class SafetyService {
    private static rules;
    private static threats;
    private static readonly MAX_THREATS;
    /**
     * 初始化
     */
    static init(): void;
    /**
     * 获取所有规则
     */
    static getAllRules(): SafetyRule[];
    /**
     * 获取规则
     */
    static getRule(ruleId: string): SafetyRule | undefined;
    /**
     * 添加规则
     */
    static addRule(rule: SafetyRule): void;
    /**
     * 更新规则
     */
    static updateRule(ruleId: string, updates: Partial<SafetyRule>): boolean;
    /**
     * 删除规则
     */
    static deleteRule(ruleId: string): boolean;
    /**
     * 获取规则列表（带分页）
     */
    static getRules(): SafetyRule[];
    /**
     * 获取安全评分
     */
    static getSafetyScore(): {
        score: number;
    };
    /**
     * 记录威胁（供 detectThreats 中间件调用）
     */
    static logThreat(threat: ThreatRecord): void;
    /**
     * 获取威胁统计
     */
    static getThreatStats(): {
        todayTotal: number;
        blockedCount: number;
    };
    /**
     * 获取威胁列表
     */
    static getThreats(params?: {
        page?: number;
        limit?: number;
        type?: string;
        severity?: string;
    }): {
        data: ThreatRecord[];
        meta: {
            total: number;
            page: number;
            limit: number;
        };
    };
}
//# sourceMappingURL=SafetyService.d.ts.map