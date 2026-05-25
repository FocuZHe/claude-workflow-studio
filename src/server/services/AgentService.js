const AgentModel = require('../models/Agent');
const SkillService = require('./SkillService');
const McpService = require('./McpService');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * Agent business logic service
 */
class AgentService {
  static _broadcastService = null;

  /**
   * Initialize AgentService with broadcast dependency
   * @param {import('./BroadcastService')} broadcastService
   */
  static init(broadcastService) {
    AgentService._broadcastService = broadcastService;
  }

  /**
   * Broadcast a WebSocket event if broadcastService is available
   * @param {string} type
   * @param {object} payload
   */
  static _broadcast(type, payload) {
    if (AgentService._broadcastService) {
      AgentService._broadcastService.broadcast(type, payload);
    }
  }

  /**
   * Create a new agent
   */
  static create(data) {
    const agent = AgentModel.create(data);
    logger.info(`Agent created: ${agent.id}`, { name: agent.name, role: agent.role });

    // Skills now live on agent.skillNames directly — no auto-assign needed

    this._broadcast('agent.created', { agent });
    return agent;
  }

  /**
   * List agents with filters and pagination
   */
  static list(filters) {
    return AgentModel.findAll(filters);
  }

  /**
   * Get agent by ID
   */
  static getById(id) {
    const agent = AgentModel.findById(id);
    if (!agent) {
      throw new AppError('NOT_FOUND', `Agent with id '${id}' not found`, 404);
    }
    return agent;
  }

  /**
   * Update agent
   */
  static update(id, data) {
    const agent = AgentModel.update(id, data);
    if (!agent) {
      throw new AppError('NOT_FOUND', `Agent with id '${id}' not found`, 404);
    }
    logger.info(`Agent updated: ${id}`);
    this._broadcast('agent.updated', { agent });
    return agent;
  }

  /**
   * Delete agent
   */
  static delete(id) {
    const agent = AgentModel.findById(id);
    if (!agent) {
      throw new AppError('NOT_FOUND', `Agent with id '${id}' not found`, 404);
    }

    const deleted = AgentModel.delete(id);
    if (!deleted) {
      throw new AppError('INTERNAL_ERROR', '删除智能体失败', 500);
    }
    logger.info(`Agent deleted: ${id}`);
    this._broadcast('agent.deleted', { agentId: id });
    return true;
  }

  /**
   * Get agent logs
   */
  static getLogs(id, limit = 50) {
    const logs = AgentModel.getLogs(id, limit);
    if (logs === null) {
      throw new AppError('NOT_FOUND', `Agent with id '${id}' not found`, 404);
    }
    return logs;
  }

  /**
   * Add log to agent
   */
  static addLog(id, level, message) {
    return AgentModel.addLog(id, level, message);
  }

  /**
   * Update agent status
   */
  static updateStatus(id, status) {
    const previous = AgentModel.findById(id);
    if (!previous) {
      throw new AppError('NOT_FOUND', `Agent with id '${id}' not found`, 404);
    }
    const previousStatus = previous.status;
    const agent = AgentModel.update(id, { status });
    return { agent, previousStatus };
  }
}

module.exports = AgentService;
