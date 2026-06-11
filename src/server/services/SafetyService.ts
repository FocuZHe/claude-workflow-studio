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

export class SafetyService {
  private static rules: SafetyRule[] = [];

  /**
   * 初始化
   */
  static init(): void {
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
  static getAllRules(): SafetyRule[] {
    return this.rules;
  }

  /**
   * 获取规则
   */
  static getRule(ruleId: string): SafetyRule | undefined {
    return this.rules.find(rule => rule.id === ruleId);
  }

  /**
   * 添加规则
   */
  static addRule(rule: SafetyRule): void {
    this.rules.push(rule);
  }

  /**
   * 更新规则
   */
  static updateRule(ruleId: string, updates: Partial<SafetyRule>): boolean {
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
  static deleteRule(ruleId: string): boolean {
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
  static getRules(): SafetyRule[] {
    return [...this.rules];
  }

  /**
   * 获取安全评分
   */
  static getSafetyScore(): { score: number } {
    const enabledRules = this.rules.filter(r => r.enabled).length;
    const score = Math.min(100, enabledRules * 20);
    return { score };
  }

  /**
   * 获取威胁统计
   */
  static getThreatStats(): { todayTotal: number; blockedCount: number } {
    return { todayTotal: 0, blockedCount: 0 };
  }

  /**
   * 获取威胁列表
   */
  static getThreats(params: { page?: number; limit?: number; type?: string; severity?: string } = {}): { data: any[]; meta: { total: number; page: number; limit: number } } {
    const page = params.page || 1;
    const limit = params.limit || 20;
    return {
      data: [],
      meta: { total: 0, page, limit }
    };
  }
}

// 初始化
SafetyService.init();

module.exports = SafetyService;
