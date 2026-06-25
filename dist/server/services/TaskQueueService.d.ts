/**
 * TaskQueueService - 任务队列服务
 * 管理异步任务队列，支持顺序执行、暂停/恢复、错误处理
 * 存储委托给 TaskQueueModel（单一数据源，避免与 Model 状态不同步）
 */
export interface Task {
    id: string;
    type: string;
    data: any;
    status: 'pending' | 'running' | 'completed' | 'failed';
    result?: any;
    error?: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface TaskQueue {
    id: string;
    name: string;
    description?: string;
    workflowId: string;
    status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    items: any[];
    currentItemIndex: number;
    autoStopOnError: boolean;
    createdAt: Date;
    updatedAt: Date;
}
export declare class TaskQueueService {
    private static tasks;
    private static _broadcastService;
    private static _runningQueues;
    /**
     * 初始化广播服务
     */
    static init(broadcastService: any): void;
    /**
     * 重置卡住的任务（启动时恢复）
     * running 任务重置为 pending；running/paused 队列重置为 failed（启动前未完成的视为失败）
     *   注：running→pending / paused→pending 在状态机中非法，故重置为 failed
     */
    static resetStuckQueues(): void;
    /**
     * 广播队列状态变化
     */
    static _broadcastQueueUpdate(queueId: string, event: string, data?: any): void;
    /**
     * 添加任务
     */
    static addTask(type: string, data: any): Task;
    /**
     * 获取任务
     */
    static getTask(taskId: string): Task | undefined;
    /**
     * 更新任务状态
     */
    static updateTaskStatus(taskId: string, status: Task['status'], result?: any, error?: string): Task | undefined;
    /**
     * 获取所有任务
     */
    static getAllTasks(): Task[];
    /**
     * 创建任务队列（委托 TaskQueueModel）
     */
    static create(data: any): any;
    /**
     * 列出任务队列（委托 TaskQueueModel）
     */
    static list(params: {
        status?: string;
        workflowId?: string;
        page?: string;
        limit?: string;
    }): {
        items: any[];
        total: number;
        page: number;
        limit: number;
    };
    /**
     * 获取单个任务队列（委托 TaskQueueModel，null 抛 404）
     */
    static getById(id: string): any;
    /**
     * 更新任务队列元数据（委托 TaskQueueModel）
     */
    static update(id: string, data: any): any;
    /**
     * 删除任务队列（running 队列抛 409）
     */
    static delete(id: string): void;
    /**
     * 开始执行队列
     */
    static start(id: string): Promise<any>;
    /**
     * 暂停队列
     */
    static pause(id: string): any;
    /**
     * 恢复队列
     */
    static resume(id: string): Promise<any>;
    /**
     * 取消队列
     */
    static cancel(id: string): any;
    /**
     * 执行队列（内部方法）
     */
    private static _executeQueue;
    /**
     * 添加队列项
     */
    static addItem(queueId: string, data: any): any;
    /**
     * 删除队列项
     */
    static removeItem(queueId: string, itemId: string): void;
    /**
     * 任务完成回调（由 TaskService 调用）
     */
    static _onTaskComplete(queueId: string, itemId: string, taskId: string, result: any): void;
    /**
     * 任务失败回调（由 TaskService 调用）
     */
    static _onTaskFail(queueId: string, itemId: string, taskId: string, error: string): void;
    /**
     * 通知人工干预（暂停队列，将当前 item 标记为 waiting_human）
     */
    static notifyHumanIntervention(queueId: string, runId: string, nodeId: string, type: string): void;
    /**
     * 通知人工响应（恢复队列，将 waiting_human 的 item 转回 running）
     */
    static notifyHumanResponse(queueId: string, workflowId: string, nodeId: string): void;
    /**
     * 继续执行队列（内部方法）
     */
    private static _continueQueue;
}
//# sourceMappingURL=TaskQueueService.d.ts.map