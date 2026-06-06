"use strict";
/**
 * AgentTemplateService - Agent模板服务
 * 管理预设的Agent模板和自定义模板
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentTemplateService = void 0;
class AgentTemplateService {
    static builtinTemplates = [
        {
            id: 'tpl-architect',
            name: '🏗️ 架构师',
            role: 'planner',
            description: '系统设计、技术选型、架构评审',
            model: 'opus',
            agentType: 'general',
            systemPrompt: '你是一位资深软件架构师。',
            isBuiltin: true
        },
        {
            id: 'tpl-fullstack',
            name: '💻 全栈开发者',
            role: 'developer',
            description: '前后端开发、数据库、API',
            model: 'sonnet',
            agentType: 'build',
            systemPrompt: '你是一位全栈开发工程师。',
            isBuiltin: true
        },
        {
            id: 'tpl-tester',
            name: '🧪 测试工程师',
            role: 'tester',
            description: '编写测试、发现Bug、回归测试',
            model: 'sonnet',
            agentType: 'test',
            systemPrompt: '你是一位测试工程师。',
            isBuiltin: true
        },
        {
            id: 'tpl-reviewer',
            name: '🔍 代码审查员',
            role: 'reviewer',
            description: '代码审查、质量检查、最佳实践建议',
            model: 'sonnet',
            agentType: 'review',
            systemPrompt: '你是一位经验丰富的代码审查员。',
            isBuiltin: true
        },
        {
            id: 'tpl-devops',
            name: '🚀 DevOps工程师',
            role: 'devops',
            description: 'CI/CD、部署、运维自动化',
            model: 'sonnet',
            agentType: 'build',
            systemPrompt: '你是一位DevOps工程师。',
            isBuiltin: true
        },
        {
            id: 'tpl-analyst',
            name: '📊 数据分析师',
            role: 'analyst',
            description: '数据分析、可视化、业务洞察',
            model: 'sonnet',
            agentType: 'general',
            systemPrompt: '你是一位数据分析师。',
            isBuiltin: true
        },
        {
            id: 'tpl-writer',
            name: '📝 技术文档撰写者',
            role: 'writer',
            description: '技术文档、API文档、用户指南编写',
            model: 'sonnet',
            agentType: 'general',
            systemPrompt: '你是一位技术文档撰写专家。',
            isBuiltin: true
        }
    ];
    static customTemplates = [];
    /**
     * 获取所有模板（内置 + 自定义）
     */
    static getAll() {
        return [...this.builtinTemplates, ...this.customTemplates];
    }
    /**
     * 获取模板
     */
    static getById(templateId) {
        return this.getAll().find(t => t.id === templateId);
    }
    /**
     * 创建自定义模板
     */
    static create(data) {
        // 检查名称是否与内置模板冲突
        const conflict = this.builtinTemplates.find(t => t.name === data.name);
        if (conflict) {
            throw new Error(`Template name "${data.name}" conflicts with built-in template`);
        }
        const template = {
            id: `tpl-custom-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            name: data.name,
            role: data.role || 'custom',
            description: data.description || '',
            model: data.model || 'sonnet',
            agentType: 'general',
            systemPrompt: data.systemPrompt || '',
            temperature: data.temperature,
            toolPermissions: data.toolPermissions,
            isBuiltin: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.customTemplates.push(template);
        return template;
    }
    /**
     * 删除自定义模板
     */
    static delete(templateId) {
        const builtinIndex = this.builtinTemplates.findIndex(t => t.id === templateId);
        if (builtinIndex !== -1) {
            throw new Error('Cannot delete built-in template');
        }
        const customIndex = this.customTemplates.findIndex(t => t.id === templateId);
        if (customIndex === -1) {
            return false;
        }
        this.customTemplates.splice(customIndex, 1);
        return true;
    }
    /**
     * 清空自定义模板（测试用）
     */
    static clear() {
        this.customTemplates = [];
    }
    /**
     * 创建Agent从模板
     */
    static createFromTemplate(templateId, data) {
        const template = this.getById(templateId);
        if (!template)
            return null;
        return {
            ...template,
            ...data,
            id: Math.random().toString(36).substring(7)
        };
    }
}
exports.AgentTemplateService = AgentTemplateService;
module.exports = AgentTemplateService;
//# sourceMappingURL=AgentTemplateService.js.map