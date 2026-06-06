/**
 * McpService - MCP工具管理服务
 * 管理Model Context Protocol工具
 */

export interface McpTool {
  name: string;
  description: string;
  endpoint: string;
  config: Record<string, any>;
}

export class McpService {
  private static tools: Map<string, McpTool> = new Map();

  /**
   * 初始化MCP工具
   */
  static init(): void {
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
  static getTool(toolName: string): McpTool | undefined {
    return this.tools.get(toolName);
  }

  /**
   * 获取Agent的MCP工具
   */
  static getByAgent(agentId: string): McpTool[] {
    // 简化实现：返回所有工具
    return Array.from(this.tools.values());
  }

  /**
   * 获取所有MCP工具
   */
  static getAllTools(): McpTool[] {
    return Array.from(this.tools.values());
  }
}

// 初始化
McpService.init();

module.exports = McpService;
