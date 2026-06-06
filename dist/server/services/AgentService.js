"use strict";
/**
 * AgentService - Agent管理服务
 * 管理Agent的创建、更新、删除
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentService = void 0;
const AgentModel = require('../models/Agent');
class AgentService {
    static agents = new Map();
    static broadcastService;
    /**
     * 初始化服务
     */
    static init(broadcastService) {
        this.broadcastService = broadcastService;
    }
    /**
     * 创建Agent
     */
    static create(data) {
        return AgentModel.create(data);
    }
    /**
     * 获取Agent列表（分页）
     */
    static list(params = {}) {
        return AgentModel.findAll(params);
    }
    /**
     * 获取所有Agent
     */
    static findAll() {
        return AgentModel.findAll({ limit: 99999 }).items;
    }
    /**
     * 获取单个Agent
     */
    static getById(id) {
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
    static getChildren(parentId) {
        return AgentModel.findByParentId(parentId);
    }
    /**
     * 更新Agent
     */
    static update(id, data) {
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
    static delete(id) {
        return AgentModel.delete(id);
    }
    /**
     * 检查Agent是否存在
     */
    static exists(id) {
        return AgentModel.exists(id);
    }
    /**
     * 获取Agent日志
     */
    static getLogs(id, limit) {
        return AgentModel.getLogs(id, limit) || [];
    }
}
exports.AgentService = AgentService;
module.exports = AgentService;
//# sourceMappingURL=AgentService.js.map