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
}
exports.SafetyService = SafetyService;
// 初始化
SafetyService.init();
module.exports = SafetyService;
//# sourceMappingURL=SafetyService.js.map