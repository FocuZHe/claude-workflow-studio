"use strict";
/**
 * McpService - MCP工具管理服务
 * 管理Model Context Protocol工具
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpService = void 0;
class McpService {
    // 工具表（id → 工具定义）
    static tools = new Map();
    // 安装记录（toolId+agentId → 已安装）
    static installRecords = [];
    /**
     * 初始化（不预注册内置工具 —— 测试期望 clear 后列表为空）
     */
    static init() {
        // no-op
    }
    /**
     * 获取MCP工具（按工具名/旧 API）
     */
    static getTool(toolName) {
        return this.tools.get(toolName);
    }
    /**
     * 获取MCP工具（按 id 或 name）
     */
    static getById(id) {
        return this.tools.get(id);
    }
    /**
     * 获取Agent的MCP工具（返回带 id 字段的工具数组）
     */
    static getByAgent(agentId) {
        const installed = this.installRecords
            .filter(r => r.agentId === agentId)
            .map(r => this.tools.get(r.toolId))
            .filter(Boolean);
        return installed;
    }
    /**
     * 获取所有MCP工具
     */
    static getAllTools() {
        return Array.from(this.tools.values());
    }
    /**
     * 创建自定义MCP工具（isBuiltin: false）
     */
    static create(data) {
        const id = data.id || data.name || Math.random().toString(36).substring(2, 10);
        const tool = {
            id,
            name: data.name || id,
            category: data.category || 'custom',
            description: data.description || '',
            endpoint: data.endpoint || '',
            auth: data.auth || {},
            config: data.config || {},
            isBuiltin: false
        };
        this.tools.set(id, tool);
        return tool;
    }
    /**
     * 安装 MCP 工具到 Agent
     * - 不校验 toolId 是否预注册（接受市场工具）
     * - 若 toolId 不在 tools map，注册一个最小记录
     * - 已安装返回 CONFLICT
     * - 返回 { mcpId, agentId, installed: true }
     */
    static install(toolId, agentId, options = {}) {
        if (options.installAll) {
            // 广播安装：仅记录，返回聚合结果
            const exists = this.installRecords.some(r => r.toolId === toolId && r.agentId === '*');
            if (exists) {
                const err = new Error(`MCP 工具 ${toolId} 已安装到所有 agent`);
                err.code = 'CONFLICT';
                throw err;
            }
            this._ensureToolRegistered(toolId);
            this.installRecords.push({ toolId, agentId: '*' });
            return { mcpId: toolId, agentId: '*', installed: true, installAll: true };
        }
        if (!agentId) {
            const err = new Error('agentId is required');
            err.code = 'VALIDATION_ERROR';
            throw err;
        }
        const exists = this.installRecords.some(r => r.toolId === toolId && r.agentId === agentId);
        if (exists) {
            const err = new Error(`MCP 工具 ${toolId} 已安装到 ${agentId}`);
            err.code = 'CONFLICT';
            throw err;
        }
        this._ensureToolRegistered(toolId);
        this.installRecords.push({ toolId, agentId });
        return { mcpId: toolId, agentId, installed: true };
    }
    /**
     * 若 toolId 未注册，注册一个最小记录（市场工具自动注册）
     */
    static _ensureToolRegistered(toolId) {
        if (!this.tools.has(toolId)) {
            this.tools.set(toolId, {
                id: toolId,
                name: toolId,
                description: '',
                endpoint: '',
                auth: {},
                config: {},
                isBuiltin: false
            });
        }
    }
    /**
     * 从 Agent 卸载 MCP 工具
     * - 返回 { mcpId, agentId, installed: false }
     * - 未安装抛 NOT_FOUND
     */
    static uninstall(toolId, agentId) {
        const idx = this.installRecords.findIndex(r => r.toolId === toolId && r.agentId === agentId);
        if (idx === -1) {
            const err = new Error(`MCP 工具 ${toolId} 未安装到 ${agentId}`);
            err.code = 'NOT_FOUND';
            throw err;
        }
        this.installRecords.splice(idx, 1);
        return { mcpId: toolId, agentId, installed: false };
    }
    /**
     * 清空所有工具与安装记录（测试用）
     */
    static clear() {
        this.tools.clear();
        this.installRecords = [];
    }
}
exports.McpService = McpService;
// 初始化（空操作）
McpService.init();
module.exports = McpService;
//# sourceMappingURL=McpService.js.map