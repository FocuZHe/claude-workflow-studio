"use strict";
/**
 * McpService - MCP工具管理服务
 * 管理Model Context Protocol工具
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpService = void 0;
class McpService {
    static tools = new Map();
    /**
     * 初始化MCP工具
     */
    static init() {
        // 示例MCP工具
        this.tools.set('web-search', {
            name: 'web-search',
            description: '搜索网络内容',
            endpoint: 'http://localhost:3001',
            config: {}
        });
        this.tools.set('file-manager', {
            name: 'file-manager',
            description: '管理文件系统',
            endpoint: 'http://localhost:3002',
            config: {}
        });
    }
    /**
     * 获取MCP工具
     */
    static getTool(toolName) {
        return this.tools.get(toolName);
    }
    /**
     * 获取Agent的MCP工具
     */
    static getByAgent(agentId) {
        // 简化实现：返回所有工具
        return Array.from(this.tools.values());
    }
    /**
     * 获取所有MCP工具
     */
    static getAllTools() {
        return Array.from(this.tools.values());
    }
}
exports.McpService = McpService;
// 初始化
McpService.init();
module.exports = McpService;
//# sourceMappingURL=McpService.js.map