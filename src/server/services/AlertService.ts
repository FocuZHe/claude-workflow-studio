/**
 * AlertService - 告警服务
 * 管理系统告警和工作流监控
 */

export interface Alert {
  id: string;
  type: string;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
}

export interface AlertConfig {
  failureAlert: boolean;
  longRunningThreshold: number;
}

export class AlertService {
  private static alerts: Alert[] = [];
  static config: AlertConfig = {
    failureAlert: true,
    longRunningThreshold: 300000 // 5 minutes
  };

  /**
   * 添加告警
   */
  static addAlert(type: string, title: string, message: string): Alert {
    const alert: Alert = {
      id: Math.random().toString(36).substring(7),
      type,
      title,
      message,
      timestamp: new Date(),
      read: false
    };
    this.alerts.push(alert);
    return alert;
  }

  /**
   * 获取所有告警
   */
  static getAllAlerts(): Alert[] {
    return this.alerts;
  }

  /**
   * 标记为已读
   */
  static markAsRead(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) alert.read = true;
  }

  /**
   * 清空告警
   */
  static clearAlerts(): void {
    this.alerts = [];
  }

  /**
   * 获取告警配置
   */
  static getConfig(): AlertConfig {
    return { ...this.config };
  }

  /**
   * 更新告警配置
   */
  static updateConfig(newConfig: Partial<AlertConfig>): AlertConfig {
    if (newConfig.failureAlert !== undefined) {
      this.config.failureAlert = newConfig.failureAlert;
    }
    if (newConfig.longRunningThreshold !== undefined) {
      if (newConfig.longRunningThreshold < 0) {
        const { AppError } = require('../middleware/errorHandler');
        throw new AppError('VALIDATION_ERROR', 'longRunningThreshold must be non-negative', 400);
      }
      this.config.longRunningThreshold = newConfig.longRunningThreshold;
    }
    return this.getConfig();
  }

  /**
   * 检查工作流状态，失败时触发告警
   */
  static checkWorkflowStatus(workflow: any, broadcastService: any): any {
    if (!this.config.failureAlert) return null;
    if (workflow.executionStatus !== 'failed') return null;

    const alert = this.addAlert('error', '工作流失败', `工作流 "${workflow.name}" 执行失败`);
    if (broadcastService?.broadcast) {
      broadcastService.broadcast('alert.notification', {
        type: 'workflow_failure',
        level: 'error',
        workflowId: workflow.id,
        workflowName: workflow.name,
        message: alert.message
      });
    }
    return { type: 'workflow_failure', level: 'error', alert };
  }

  /**
   * 检查长时间运行的工作流
   */
  static checkLongRunning(workflow: any, broadcastService: any): any {
    if (workflow.executionStatus !== 'running') return null;

    const execLog = workflow.executionLog || [];
    const latestRun = execLog[execLog.length - 1];
    if (!latestRun?.startedAt) return null;

    const runningTime = Date.now() - new Date(latestRun.startedAt).getTime();
    if (runningTime < this.config.longRunningThreshold) return null;

    const alert = this.addAlert('warning', '工作流运行时间过长', `工作流 "${workflow.name}" 已运行 ${Math.round(runningTime / 1000)}秒`);
    if (broadcastService?.broadcast) {
      broadcastService.broadcast('alert.notification', {
        type: 'long_running',
        level: 'warn',
        workflowId: workflow.id,
        workflowName: workflow.name,
        message: alert.message
      });
    }
    return { type: 'long_running', level: 'warn', alert };
  }
}

module.exports = AlertService;
