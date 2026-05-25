const WorkflowModel = require('../models/Workflow');
const { AppError } = require('../middleware/errorHandler');

/**
 * Execution history service - extracts history from workflow execution logs
 */
class HistoryService {
  /**
   * Get execution history with filters and pagination
   * @param {Object} filters - { status, workflowName, page, limit }
   * @returns {{ items: Array, total: number, page: number, limit: number }}
   */
  static getHistory(filters = {}) {
    const { status, workflowName, page = 1, limit = 20 } = filters;

    // Collect all execution logs from all workflows
    const allWorkflows = WorkflowModel.findAll({ page: 1, limit: 9999 });
    let items = [];

    for (const workflow of allWorkflows.items) {
      for (const log of (workflow.executionLog || [])) {
        items.push({
          runId: log.runId,
          workflowId: workflow.id,
          workflowName: workflow.name,
          status: log.status,
          startedAt: log.startedAt,
          completedAt: log.completedAt,
          duration: log.completedAt && log.startedAt
            ? new Date(log.completedAt) - new Date(log.startedAt)
            : null,
          nodeResults: log.nodeResults || []
        });
      }
    }

    // Apply filters
    if (status) {
      items = items.filter(item => item.status === status);
    }
    if (workflowName) {
      const nameLower = workflowName.toLowerCase();
      items = items.filter(item => item.workflowName.toLowerCase().includes(nameLower));
    }

    // Sort by startedAt descending (most recent first)
    items.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

    // Paginate
    const total = items.length;
    const start = (page - 1) * limit;
    const paginated = items.slice(start, start + limit);

    return {
      items: paginated,
      total,
      page,
      limit
    };
  }

  /**
   * Get execution detail for a specific runId
   * @param {string} runId
   * @returns {Object} Full execution detail
   */
  static getDetail(runId) {
    if (!runId) {
      throw new AppError('VALIDATION_ERROR', 'runId is required', 400);
    }

    const allWorkflows = WorkflowModel.findAll({ page: 1, limit: 9999 });

    for (const workflow of allWorkflows.items) {
      const log = (workflow.executionLog || []).find(e => e.runId === runId);
      if (log) {
        // Enrich node results with full node info
        const nodeDetails = (log.nodeResults || []).map(nr => {
          const node = (workflow.nodes || []).find(n => n.id === nr.nodeId);
          return {
            ...nr,
            label: node ? node.label || node.id : nr.nodeId,
            type: node ? node.type : 'unknown',
            agentId: node ? node.agentId : null,
            logs: node ? node.logs || [] : []
          };
        });

        return {
          runId: log.runId,
          workflowId: workflow.id,
          workflowName: workflow.name,
          status: log.status,
          startedAt: log.startedAt,
          completedAt: log.completedAt,
          duration: log.completedAt && log.startedAt
            ? new Date(log.completedAt) - new Date(log.startedAt)
            : null,
          nodeResults: nodeDetails,
          context: workflow.context || {}
        };
      }
    }

    throw new AppError('NOT_FOUND', `Execution with runId '${runId}' not found`, 404);
  }

  /**
   * Replay a previous run - reload its context
   * @param {string} runId
   * @returns {Object} The context and input from the run
   */
  static replay(runId) {
    if (!runId) {
      throw new AppError('VALIDATION_ERROR', 'runId is required', 400);
    }

    const allWorkflows = WorkflowModel.findAll({ page: 1, limit: 9999 });

    for (const workflow of allWorkflows.items) {
      const log = (workflow.executionLog || []).find(e => e.runId === runId);
      if (log) {
        return {
          runId: log.runId,
          workflowId: workflow.id,
          workflowName: workflow.name,
          context: workflow.context || {},
          nodeResults: log.nodeResults || [],
          status: log.status,
          startedAt: log.startedAt,
          completedAt: log.completedAt
        };
      }
    }

    throw new AppError('NOT_FOUND', `Execution with runId '${runId}' not found`, 404);
  }
}

module.exports = HistoryService;
