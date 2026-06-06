/**
 * AgentService - Agent管理服务
 * 管理Agent的创建、更新、删除
 */

const AgentModel = require('../models/Agent');

export interface Agent {
  id: string;
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  createdAt: Date;
  updatedAt: Date;
}

export class AgentService {
  private static agents: Map<string, Agent> = new Map();
  private static broadcastService: any;

  /**
   * 初始化服务
   */
  static init(broadcastService?: any): void {
    this.broadcastService = broadcastService;
  }

  /**
   * 创建Agent
   */
  static create(data: any): any {
    return AgentModel.create(data);
  }

  /**
   * 获取Agent列表（分页）
   */
  static list(params: any = {}): any {
    return AgentModel.findAll(params);
  }

  /**
   * 获取所有Agent
   */
  static findAll(): any[] {
    return AgentModel.findAll({ limit: 99999 }).items;
  }

  /**
   * 获取单个Agent
   */
  static getById(id: string): any {
    const agent = AgentModel.findById(id);
    if (!agent) {
      const { AppError } = require('../middleware/errorHandler');
      throw new AppError('NOT_FOUND', `Agent ${id} not found`, 404);
    }
    return agent;
  }

  /**
   * 获取子Agent
   */
  static getChildren(parentId: string): any[] {
    return AgentModel.findByParentId(parentId);
  }

  /**
   * 更新Agent
   */
  static update(id: string, data: any): any {
    const agent = AgentModel.update(id, data);
    if (!agent) {
      const { AppError } = require('../middleware/errorHandler');
      throw new AppError('NOT_FOUND', `Agent ${id} not found`, 404);
    }
    return agent;
  }

  /**
   * 删除Agent
   */
  static delete(id: string): boolean {
    return AgentModel.delete(id);
  }

  /**
   * 检查Agent是否存在
   */
  static exists(id: string): boolean {
    return AgentModel.exists(id);
  }

  /**
   * 获取Agent日志
   */
  static getLogs(id: string, limit?: number): any[] {
    return AgentModel.getLogs(id, limit) || [];
  }
}

module.exports = AgentService;
