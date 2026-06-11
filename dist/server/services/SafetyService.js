"use strict";
/**
 * SafetyService - 安全服务
 * 管理系统安全规则
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SafetyService = void 0;
class SafetyService {
    static rules = [];
    /**
     * 初始化
     */
    static init() {
        // 添加默认规则
        this.rules.push({
            id: 'default-rate-limit',
            name: '默认速率限制',
            type: 'rate-limit',
            enabled: true,
            config: { maxRequests: 100, windowMs: 60000 }
        });
    }
    /**
     * 获取所有规则
     */
    static getAllRules() {
        return this.rules;
    }
    /**
     * 获取规则
     */
    static getRule(ruleId) {
        return this.rules.find(rule => rule.id === ruleId);
    }
    /**
     * 添加规则
     */
    static addRule(rule) {
        this.rules.push(rule);
    }
    /**
     * 更新规则
     */
    static updateRule(ruleId, updates) {
        const index = this.rules.findIndex(rule => rule.id === ruleId);
        if (index !== -1) {
            this.rules[index] = { ...this.rules[index], ...updates };
            return true;
        }
        return false;
    }
    /**
     * 删除规则
     */
    static deleteRule(ruleId) {
        const index = this.rules.findIndex(rule => rule.id === ruleId);
        if (index !== -1) {
            this.rules.splice(index, 1);
            return true;
        }
        return false;
    }
    /**
     * 获取规则列表（带分页）
     */
    static getRules() {
        return [...this.rules];
    }
    /**
     * 获取安全评分
     */
    static getSafetyScore() {
        const enabledRules = this.rules.filter(r => r.enabled).length;
        const score = Math.min(100, enabledRules * 20);
        return { score };
    }
    /**
     * 获取威胁统计
     */
    static getThreatStats() {
        return { todayTotal: 0, blockedCount: 0 };
    }
    /**
     * 获取威胁列表
     */
    static getThreats(params = {}) {
        const page = params.page || 1;
        const limit = params.limit || 20;
        return {
            data: [],
            meta: { total: 0, page, limit }
        };
    }
}
exports.SafetyService = SafetyService;
// 初始化
SafetyService.init();
module.exports = SafetyService;
//# sourceMappingURL=SafetyService.js.map