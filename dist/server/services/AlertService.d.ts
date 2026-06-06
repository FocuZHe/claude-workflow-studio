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
export declare class AlertService {
    private static alerts;
    static config: AlertConfig;
    /**
     * 添加告警
     */
    static addAlert(type: string, title: string, message: string): Alert;
    /**
     * 获取所有告警
     */
    static getAllAlerts(): Alert[];
    /**
     * 标记为已读
     */
    static markAsRead(alertId: string): void;
    /**
     * 清空告警
     */
    static clearAlerts(): void;
    /**
     * 获取告警配置
     */
    static getConfig(): AlertConfig;
    /**
     * 更新告警配置
     */
    static updateConfig(newConfig: Partial<AlertConfig>): AlertConfig;
    /**
     * 检查工作流状态，失败时触发告警
     */
    static checkWorkflowStatus(workflow: any, broadcastService: any): any;
    /**
     * 检查长时间运行的工作流
     */
    static checkLongRunning(workflow: any, broadcastService: any): any;
}
//# sourceMappingURL=AlertService.d.ts.map