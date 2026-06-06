/**
 * TaskQueueService - 任务队列服务
 * 管理异步任务队列
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
    status: 'idle' | 'running' | 'paused' | 'completed' | 'cancelled';
    items: any[];
    createdAt: Date;
    updatedAt: Date;
}
export declare class TaskQueueService {
    private static tasks;
    private static queues;
    private static _broadcastService;
    /**
     * 初始化广播服务
     */
    static init(broadcastService: any): void;
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
     * 重置卡住的任务
     */
    static resetStuckQueues(): void;
    /**
     * 创建任务队列
     */
    static create(data: any): TaskQueue;
    /**
     * 列出任务队列
     */
    static list(params: {
        status?: string;
        workflowId?: string;
        page?: string;
        limit?: string;
    }): {
        items: TaskQueue[];
        total: number;
        page: number;
        limit: number;
    };
    /**
     * 获取单个任务队列
     */
    static getById(id: string): TaskQueue;
    /**
     * 更新任务队列
     */
    static update(id: string, data: any): TaskQueue;
    /**
     * 删除任务队列
     */
    static delete(id: string): void;
    /**
     * 开始执行队列
     */
    static start(id: string): Promise<TaskQueue>;
    /**
     * 暂停队列
     */
    static pause(id: string): TaskQueue;
    /**
     * 恢复队列
     */
    static resume(id: string): Promise<TaskQueue>;
    /**
     * 取消队列
     */
    static cancel(id: string): TaskQueue;
    /**
     * 添加队列项
     */
    static addItem(queueId: string, data: any): any;
    /**
     * 删除队列项
     */
    static removeItem(queueId: string, itemId: string): void;
}
//# sourceMappingURL=TaskQueueService.d.ts.map