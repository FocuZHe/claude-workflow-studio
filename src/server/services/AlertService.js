const logger = require('../utils/logger');

/**
 * Alert service - monitors workflow status and broadcasts alerts
 */
class AlertService {
  /** @type {Object} Alert configuration */
  static config = {
    failureAlert: true,
    longRunningThreshold: 300000 // 5 minutes in ms
  };

  /**
   * Check workflow status and broadcast alert on failure
   * @param {Object} workflow - Workflow object
   * @param {import('./BroadcastService')} broadcastService
   */
  static checkWorkflowStatus(workflow, broadcastService) {
    if (!AlertService.config.failureAlert) return null;
    if (!workflow || !broadcastService) return null;

    if (workflow.executionStatus === 'failed') {
      const alert = {
        type: 'workflow_failure',
        level: 'error',
        workflowId: workflow.id,
        workflowName: workflow.name,
        message: `Workflow "${workflow.name}" has failed`,
        timestamp: new Date().toISOString()
      };

      logger.warn('Alert: workflow failure', { workflowId: workflow.id });
      broadcastService.broadcast('alert.notification', alert);
      return alert;
    }

    return null;
  }

  /**
   * Check if workflow has been running too long and broadcast alert
   * @param {Object} workflow - Workflow object
   * @param {import('./BroadcastService')} broadcastService
   */
  static checkLongRunning(workflow, broadcastService) {
    if (!workflow || !broadcastService) return null;
    if (workflow.executionStatus !== 'running') return null;

    const threshold = AlertService.config.longRunningThreshold;
    const latestRun = workflow.executionLog && workflow.executionLog.length > 0
      ? workflow.executionLog[workflow.executionLog.length - 1]
      : null;

    if (!latestRun || !latestRun.startedAt) return null;

    const elapsed = Date.now() - new Date(latestRun.startedAt).getTime();
    if (elapsed > threshold) {
      const alert = {
        type: 'long_running',
        level: 'warn',
        workflowId: workflow.id,
        workflowName: workflow.name,
        message: `Workflow "${workflow.name}" has been running for ${Math.round(elapsed / 1000)}s (threshold: ${Math.round(threshold / 1000)}s)`,
        elapsed,
        threshold,
        timestamp: new Date().toISOString()
      };

      logger.warn('Alert: long running workflow', { workflowId: workflow.id, elapsed });
      broadcastService.broadcast('alert.notification', alert);
      return alert;
    }

    return null;
  }

  /**
   * Get current alert configuration
   * @returns {Object}
   */
  static getConfig() {
    return { ...AlertService.config };
  }

  /**
   * Update alert configuration
   * @param {Object} newConfig
   * @returns {Object} Updated config
   */
  static updateConfig(newConfig) {
    if (newConfig.failureAlert !== undefined) {
      AlertService.config.failureAlert = !!newConfig.failureAlert;
    }
    if (newConfig.longRunningThreshold !== undefined) {
      const val = Number(newConfig.longRunningThreshold);
      if (isNaN(val) || val < 0) {
        const { AppError } = require('../middleware/errorHandler');
        throw new AppError('VALIDATION_ERROR', 'longRunningThreshold must be a non-negative number', 400);
      }
      AlertService.config.longRunningThreshold = val;
    }
    logger.info('Alert config updated', AlertService.config);
    return { ...AlertService.config };
  }
}

module.exports = AlertService;
