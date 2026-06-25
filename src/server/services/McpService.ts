/**
 * McpService - MCP工具管理服务
 * 管理Model Context Protocol工具
 */

export interface McpTool {
  id: string;
  name: string;
  category?: string;
  description: string;
  endpoint: string;
  auth?: any;
  config?: Record<string, any>;
  isBuiltin: boolean;
}

interface InstallRecord {
  toolId: string;
  agentId: string;
}

export class McpService {
  // 工具表（id → 工具定义）
  static tools: Map<string, McpTool> = new Map();
  // 安装记录（toolId+agentId → 已安装）
  static installRecords: InstallRecord[] = [];

  /**
   * 初始化（不预注册内置工具 —— 测试期望 clear 后列表为空）
   */
  static init(): void {
    // no-op
  }

  /**
   * 获取MCP工具（按工具名/旧 API）
   */
  static getTool(toolName: string): McpTool | undefined {
    return this.tools.get(toolName);
  }

  /**
   * 获取MCP工具（按 id 或 name）
   */
  static getById(id: string): McpTool | undefined {
    return this.tools.get(id);
  }

  /**
   * 获取Agent的MCP工具（返回带 id 字段的工具数组）
   */
  static getByAgent(agentId: string): McpTool[] {
    const installed = this.installRecords
      .filter(r => r.agentId === agentId)
      .map(r => this.tools.get(r.toolId))
      .filter(Boolean) as McpTool[];
    return installed;
  }

  /**
   * 获取所有MCP工具
   */
  static getAllTools(): McpTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 创建自定义MCP工具（isBuiltin: false）
   */
  static create(data: Partial<McpTool>): McpTool {
    const id = data.id || data.name || Math.random().toString(36).substring(2, 10);
    const tool: McpTool = {
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
  static install(toolId: string, agentId: string, options: { installAll?: boolean } = {}): any {
    if (options.installAll) {
      // 广播安装：仅记录，返回聚合结果
      const exists = this.installRecords.some(r => r.toolId === toolId && r.agentId === '*');
      if (exists) {
        const err: any = new Error(`MCP 工具 ${toolId} 已安装到所有 agent`);
        err.code = 'CONFLICT';
        throw err;
      }
      this._ensureToolRegistered(toolId);
      this.installRecords.push({ toolId, agentId: '*' });
      return { mcpId: toolId, agentId: '*', installed: true, installAll: true };
    }

    if (!agentId) {
      const err: any = new Error('agentId is required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const exists = this.installRecords.some(r => r.toolId === toolId && r.agentId === agentId);
    if (exists) {
      const err: any = new Error(`MCP 工具 ${toolId} 已安装到 ${agentId}`);
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
  private static _ensureToolRegistered(toolId: string): void {
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
  static uninstall(toolId: string, agentId: string): any {
    const idx = this.installRecords.findIndex(r => r.toolId === toolId && r.agentId === agentId);
    if (idx === -1) {
      const err: any = new Error(`MCP 工具 ${toolId} 未安装到 ${agentId}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    this.installRecords.splice(idx, 1);
    return { mcpId: toolId, agentId, installed: false };
  }

  /**
   * 清空所有工具与安装记录（测试用）
   */
  static clear(): void {
    this.tools.clear();
    this.installRecords = [];
  }
}

// 初始化（空操作）
McpService.init();

module.exports = McpService;
