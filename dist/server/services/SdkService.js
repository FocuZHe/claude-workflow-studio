"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { Anthropic } = require('@anthropic-ai/sdk');
const { query, InMemorySessionStore } = require('@anthropic-ai/claude-agent-sdk');
const { EventEmitter } = require('events');
const pLimit = require('p-limit');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { AppError } = require('../middleware/errorHandler');
const ApiKeyService = require('./ApiKeyService');
const logger = require('../utils/logger');
// 网络错误代码（用于网络自愈）
const NETWORK_ERRORS = [
    'ENOTFOUND',
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EPIPE',
    'EAI_AGAIN',
];
// 日志目录
const LOGS_DIR = path.join(process.cwd(), 'logs');
/**
 * 生成任务的确定性哈希（用于去重）
 * 基于任务描述、允许的文件范围和模型生成唯一标识
 */
function getTaskKey(task) {
    const normalized = {
        taskId: task.taskId || null, // 使用 taskId 作为唯一标识
        desc: (task.description || task.task || '').trim(),
        allowedFiles: (task.allowedFiles || []).slice().sort(),
        model: task.model || 'default'
    };
    const json = JSON.stringify(normalized);
    return crypto.createHash('sha256').update(json).digest('hex');
}
/**
 * SDK-based Claude execution engine
 * 使用 Anthropic SDK 替代 CLI spawn，实现真正的多 Agent 协作
 *
 */
class SdkService extends EventEmitter {
    broadcastService;
    activeStreams;
    _messageBuffers;
    _taskWorkflowMap;
    _taskMetaMap;
    _pendingApprovals;
    _maxAgentDepth;
    _agentCallIndex;
    _executableNodes;
    _checkpointCallback;
    _nodeRegistry;
    // 任务去重缓存
    _completedTasks;
    _runningTasks;
    _cacheFilePath;
    // 并发控制
    _agentLimit;
    _gitLockLimit;
    // 活跃的子Agent运行器
    _activeRunners; // SubAgentRunner instances
    // 关机标志
    _isShuttingDown;
    // 环境变量操作互斥锁（防止并发SDK调用丢失auth token）
    _envMutex;
    // 每任务熔断器（替代全局熔断器，避免任务间互相影响）
    _circuitBreakers;
    constructor(broadcastService) {
        super(); // 调用 EventEmitter 构造函数
        this.broadcastService = broadcastService;
        this.activeStreams = new Map();
        this._messageBuffers = new Map();
        this._taskWorkflowMap = new Map();
        this._taskMetaMap = new Map();
        this._pendingApprovals = new Map();
        this._maxAgentDepth = 3;
        this._agentCallIndex = 0;
        this._executableNodes = [];
        this._checkpointCallback = null;
        this._nodeRegistry = {};
        // 初始化去重缓存
        this._completedTasks = new Set();
        this._runningTasks = new Map();
        this._cacheFilePath = path.join(process.cwd(), 'data', '.task_cache.json');
        // 并发控制：最多5个子Agent同时运行
        this._agentLimit = pLimit(5);
        // Git操作串行锁：防止worktree锁冲突
        this._gitLockLimit = pLimit(1);
        // 活跃的子Agent运行器
        this._activeRunners = new Map();
        // 关机标志
        this._isShuttingDown = false;
        // 环境变量互斥锁
        this._envMutex = Promise.resolve();
        // 调用树追踪（级联调用监控）
        this._callingTrees = new Map(); // taskId -> CallingTreeNode
        this._toolUseCounters = new Map(); // taskId -> count
        // 每任务熔断器
        this._circuitBreakers = new Map();
        // 启动时加载缓存
        this._loadCache();
        // 注册关机清理
        this._registerShutdownHooks();
    }
    /**
     * 获取任务对应的熔断器（每个任务独立，避免互相影响）
     * @param taskId 任务ID
     * @returns 该任务的 CircuitBreaker 实例
     */
    _getCircuitBreaker(taskId) {
        if (!this._circuitBreakers.has(taskId)) {
            const { CircuitBreaker } = require('../utils/CircuitBreaker');
            this._circuitBreakers.set(taskId, new CircuitBreaker({
                failureThreshold: 5,
                cooldownMs: 30000,
                halfOpenMaxAttempts: 2
            }));
        }
        return this._circuitBreakers.get(taskId);
    }
    /**
     * 环境变量操作互斥锁
     * 防止并发SDK调用同时操作process.env导致auth token丢失
     */
    async _withEnvLock(fn) {
        let result;
        let error = null;
        this._envMutex = this._envMutex.then(async () => {
            const savedAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
            const savedApiKey = process.env.ANTHROPIC_API_KEY;
            delete process.env.ANTHROPIC_AUTH_TOKEN;
            delete process.env.ANTHROPIC_API_KEY;
            try {
                result = await fn();
            }
            catch (e) {
                error = e;
            }
            finally {
                if (savedAuthToken)
                    process.env.ANTHROPIC_AUTH_TOKEN = savedAuthToken;
                if (savedApiKey)
                    process.env.ANTHROPIC_API_KEY = savedApiKey;
            }
        }).catch(() => {
            // 重置锁状态，防止永久锁死
            this._envMutex = Promise.resolve();
        });
        await this._envMutex;
        if (error)
            throw error;
        return result;
    }
    /**
     * 加载已完成任务的缓存（持久化）
     */
    async _loadCache() {
        try {
            const data = JSON.parse(await fsPromises.readFile(this._cacheFilePath, 'utf-8'));
            if (Array.isArray(data)) {
                this._completedTasks = new Set(data);
                logger.info(`已加载 ${this._completedTasks.size} 个任务缓存`);
            }
        }
        catch (e) {
            if (e.code !== 'ENOENT') {
                logger.warn('加载任务缓存失败:', e.message);
            }
        }
    }
    /**
     * 保存已完成任务的缓存（持久化）
     */
    _saveCache() {
        try {
            const dir = path.dirname(this._cacheFilePath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this._cacheFilePath, JSON.stringify([...this._completedTasks]), 'utf-8');
        }
        catch (e) {
            logger.warn('保存任务缓存失败:', e);
        }
    }
    /**
     * 检查任务是否已执行或正在执行
     * @returns {boolean} true 表示应该跳过（已执行或正在执行）
     */
    _isTaskDuplicate(task) {
        const key = getTaskKey(task);
        if (this._completedTasks.has(key)) {
            logger.info(`任务去重: 跳过已完成的任务 (hash: ${key.slice(0, 8)}...)`);
            return true;
        }
        if (this._runningTasks.has(key)) {
            logger.info(`任务去重: 跳过正在执行的任务 (hash: ${key.slice(0, 8)}...)`);
            return true;
        }
        return false;
    }
    /**
     * 标记任务为正在执行
     */
    _markTaskRunning(task, promise) {
        const key = getTaskKey(task);
        this._runningTasks.set(key, promise);
    }
    /**
     * 标记任务为已完成
     */
    _markTaskCompleted(task) {
        const key = getTaskKey(task);
        this._completedTasks.add(key);
        // 清理过大的 _completedTasks 缓存，防止内存泄漏
        if (this._completedTasks.size > 1000) {
            const entries = Array.from(this._completedTasks);
            const toRemove = entries.slice(0, entries.length - 1000);
            toRemove.forEach(entry => this._completedTasks.delete(entry));
        }
        this._runningTasks.delete(key);
        // 持久化缓存
        this._saveCache();
    }
    /**
     * 清除任务缓存（可选，用于重置）
     */
    clearTaskCache() {
        this._completedTasks.clear();
        this._runningTasks.clear();
        try {
            if (fs.existsSync(this._cacheFilePath)) {
                fs.unlinkSync(this._cacheFilePath);
            }
        }
        catch (e) { /* ignore */ }
        logger.info('任务缓存已清除');
    }
    // ── 关机清理 ─────────────────────────────────
    /**
     * 注册关机钩子，确保优雅关闭所有子进程
     */
    _registerShutdownHooks() {
        const shutdownHandler = async (signal) => {
            logger.info(`收到 ${signal} 信号，开始优雅关闭...`);
            await this.shutdownAll();
            process.exit(0);
        };
        process.on('SIGINT', () => shutdownHandler('SIGINT'));
        process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
        process.on('beforeExit', () => {
            if (!this._isShuttingDown) {
                this.shutdownAll().catch(() => { });
            }
        });
    }
    /**
     * 优雅关闭所有活跃的子Agent
     */
    async shutdownAll() {
        if (this._isShuttingDown)
            return;
        this._isShuttingDown = true;
        const activeCount = this.activeStreams.size + this._activeRunners.size;
        logger.warn(`正在强制回收当前活跃进程... 数量: ${activeCount}`);
        // 终止所有活跃流
        for (const [taskId, stream] of this.activeStreams.entries()) {
            try {
                if (stream.abortController) {
                    stream.abortController.abort('SHUTDOWN');
                }
            }
            catch (err) {
                logger.error(`物理杀死进程 ${taskId} 失败`, err.message);
            }
        }
        this.activeStreams.clear();
        // 终止所有活跃运行器
        for (const [id, runner] of this._activeRunners.entries()) {
            try {
                if (runner.kill) {
                    runner.kill();
                }
            }
            catch (err) {
                logger.error(`物理杀死运行器 ${id} 失败`, err.message);
            }
        }
        this._activeRunners.clear();
        logger.info('所有活跃进程已回收');
    }
    // ── JSON 安全解析 ─────────────────────────────────
    /**
     * 安全解析JSON，防止解析崩溃
     * @param rawText 原始文本
     * @returns 解析后的对象，解析失败返回 { pass: false, reason: "..." }
     */
    _parseJsonSafely(rawText) {
        try {
            // 提取可能的JSON边界
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return { pass: false, reason: '无法解析返回的 JSON 结构。' };
        }
        catch {
            return { pass: false, reason: '返回的内容格式损坏。' };
        }
    }
    // ── 调用树追踪（级联调用监控）─────────────────────────────────
    /**
     * 记录工具调用到调用树
     * @param taskId 主任务ID
     * @param toolName 工具名称
     * @param toolInput 工具输入
     * @param parentToolUseId 父工具调用ID（用于级联追踪）
     * @param sessionId 会话ID
     */
    _trackToolCall(taskId, toolName, toolInput, parentToolUseId, sessionId) {
        // 获取或创建调用树
        if (!this._callingTrees.has(taskId)) {
            this._callingTrees.set(taskId, {
                id: taskId,
                toolCalls: [],
                startTime: new Date(),
                totalToolCalls: 0
            });
        }
        const tree = this._callingTrees.get(taskId);
        tree.totalToolCalls++;
        // 记录工具调用
        const toolCall = {
            id: `${taskId}_${tree.totalToolCalls}`,
            toolName,
            toolInput: typeof toolInput === 'object' ? JSON.stringify(toolInput).substring(0, 1000) : String(toolInput || '').substring(0, 1000),
            parentToolUseId: parentToolUseId || null,
            sessionId: sessionId || null,
            timestamp: new Date(),
            depth: parentToolUseId ? this._calculateDepth(taskId, parentToolUseId) : 0
        };
        tree.toolCalls.push(toolCall);
        // 广播调用树更新
        this.emit('calling_tree_updated', {
            taskId,
            tree: this._getCallingTree(taskId),
            timestamp: new Date()
        });
    }
    /**
     * 计算工具调用深度（用于级联追踪）
     */
    _calculateDepth(taskId, parentToolUseId) {
        const tree = this._callingTrees.get(taskId);
        if (!tree)
            return 0;
        const parentCall = tree.toolCalls.find(call => call.id === parentToolUseId || call.toolInput?.includes(parentToolUseId));
        return parentCall ? (parentCall.depth || 0) + 1 : 1;
    }
    /**
     * 获取调用树
     * @param taskId 主任务ID
     * @returns 调用树结构
     */
    _getCallingTree(taskId) {
        const tree = this._callingTrees.get(taskId);
        if (!tree)
            return null;
        return {
            ...tree,
            duration: Date.now() - tree.startTime.getTime(),
            toolCalls: tree.toolCalls.map(call => ({
                ...call,
                timestamp: call.timestamp.toISOString()
            }))
        };
    }
    /**
     * 清理调用树（任务完成后）
     * @param taskId 主任务ID
     */
    _cleanupCallingTree(taskId) {
        this._callingTrees.delete(taskId);
        this._toolUseCounters.delete(taskId);
    }
    // ── Git Worktree 隔离管理（带锁保护）─────────────────────────────────
    /**
     * 为子Agent创建独立的 Git worktree
     * @param agentId 子Agent的唯一标识
     * @param workspaceRoot 工作区根目录
     * @returns worktree 的绝对路径
     */
    async _createWorktree(agentId, workspaceRoot) {
        // worktree必须在项目内，因为子Agent需要在项目中创建/修改文件
        const worktreePath = path.join(workspaceRoot, '.worktrees', agentId);
        const branchName = `agent-${agentId}`;
        try {
            // 清理可能存在的旧 worktree
            await this._forcePruneWorktree(agentId, workspaceRoot);
            // 创建新的 worktree
            await execAsync(`git worktree add "${worktreePath}" -b "${branchName}"`, {
                cwd: workspaceRoot,
                timeout: 30000
            });
            logger.info(`为子Agent ${agentId} 创建 worktree: ${worktreePath}`);
            return worktreePath;
        }
        catch (err) {
            logger.error(`创建 worktree 失败: ${agentId}`, { error: err.message });
            throw new Error(`Git worktree 创建失败: ${err.message}`);
        }
    }
    /**
     * 强制清理特定 worktree（幂等操作）
     */
    async _forcePruneWorktree(agentId, workspaceRoot) {
        const worktreePath = path.join(workspaceRoot, '.worktrees', agentId);
        const branchName = `agent-${agentId}`;
        try {
            // 移除 worktree 目录
            if (fs.existsSync(worktreePath)) {
                await execAsync(`git worktree remove "${worktreePath}" --force`, {
                    cwd: workspaceRoot,
                    timeout: 15000
                });
            }
        }
        catch (_) { /* 忽略 */ }
        try {
            // 清理 worktree 引用
            await execAsync('git worktree prune', { cwd: workspaceRoot });
        }
        catch (_) { /* 忽略 */ }
        try {
            // 删除分支
            await execAsync(`git branch -D "${branchName}"`, { cwd: workspaceRoot });
        }
        catch (_) { /* 忽略 */ }
    }
    /**
     * 清理所有子Agent的 worktree
     */
    async _cleanupAllWorktrees(workspaceRoot) {
        const worktreesDir = path.join(workspaceRoot, '.worktrees');
        if (!fs.existsSync(worktreesDir))
            return;
        try {
            const entries = fs.readdirSync(worktreesDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.startsWith('node_')) {
                    await this._forcePruneWorktree(entry.name, workspaceRoot);
                }
            }
            logger.info('已清理所有子Agent worktree');
        }
        catch (err) {
            logger.warn('清理 worktree 时出错:', err);
        }
    }
    /**
     * 获取 worktree 的摘要信息（用于合并结果）
     */
    async _getWorktreeSummary(worktreePath) {
        try {
            const { stdout: diff } = await execAsync('git diff --stat', {
                cwd: worktreePath,
                timeout: 10000
            });
            const { stdout: newFiles } = await execAsync('git ls-files --others --exclude-standard', {
                cwd: worktreePath,
                timeout: 10000
            });
            let summary = '';
            if (diff.trim())
                summary += `修改的文件:\n${diff}\n`;
            if (newFiles.trim())
                summary += `新增的文件:\n${newFiles}\n`;
            return summary || '无文件变更';
        }
        catch (_) {
            return '无法获取变更摘要';
        }
    }
    /**
     * Get file snapshot (same as ClaudeService for compatibility)
     */
    _getFilesSnapshot(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            const files = new Set();
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name === 'WORKFLOWS' || entry.name === 'node_modules')
                    continue;
                if (entry.isFile()) {
                    files.add(entry.name);
                }
                else if (entry.isDirectory()) {
                    try {
                        const sub = fs.readdirSync(path.join(dir, entry.name), { withFileTypes: true });
                        for (const s of sub) {
                            if (s.isFile())
                                files.add(entry.name + '/' + s.name);
                        }
                    }
                    catch (e) { /* ignore */ }
                }
            }
            return files;
        }
        catch (e) {
            return new Set();
        }
    }
    // ── Git Worktree 带锁保护 ─────────────────────────────────
    /**
     * 带锁保护的 worktree 创建（防止 Git 锁冲突）
     */
    async _createWorktreeWithLock(agentId, workspaceRoot) {
        return this._gitLockLimit(() => this._createWorktree(agentId, workspaceRoot));
    }
    /**
     * 带锁保护的 worktree 清理（防止 Git 锁冲突）
     */
    async _cleanupWorktreeWithLock(agentId, workspaceRoot) {
        return this._gitLockLimit(() => this._forcePruneWorktree(agentId, workspaceRoot));
    }
    // ── 自治判断节点（Autonomous Decision）─────────────────────────────────
    /**
     * 自治判断工作流：AI自动验证输出质量，不通过则自动重试
     * @param taskId 任务ID
     * @param initialPrompt 初始提示词
     * @param workspaceRoot 工作区根目录
     * @param maxAttempts 最大重试次数
     * @param evaluatorModel 评估器使用的模型（默认haiku，快速轻量）
     * @returns 最终结果
     */
    async executeAutonomousDecisionFlow(taskId, initialPrompt, workspaceRoot, maxAttempts = 3, evaluatorModel = 'haiku') {
        logger.info(`[Master] 启动 [${taskId}] 的自治判定工作流...`);
        let isPassed = false;
        let attempts = 0;
        let currentPrompt = initialPrompt;
        let lastResult = '';
        // 创建本循环独占的 Worktree（带锁保护）
        const worktreePath = await this._createWorktreeWithLock(taskId, workspaceRoot);
        try {
            while (!isPassed && attempts < maxAttempts) {
                attempts++;
                logger.info(`[Master] 开始第 ${attempts}/${maxAttempts} 次代码生成尝试...`);
                // 1. 运行子Agent编写代码
                lastResult = await this._executeWithClaudeSdk(`${taskId}_attempt_${attempts}`, null, currentPrompt, { folderPath: worktreePath });
                // 2. 启动自治判断：让快速轻量的判定Agent审查代码
                logger.info(`[Master] 激活自治审查节点，评估代码质量...`);
                const evalPrompt = `
请对以下代码/输出进行细致的安全与功能审查，判断其是否完成了要求的目标。

【待审查内容】：
${lastResult}

请严格以下列 JSON 格式回复，不要有任何多余的说明字符：
{
  "pass": true 或者 false,
  "reason": "如果不通过，请写明具体的原因与缺陷"
}
`;
                // 使用快速模型进行自主评估
                const evalRaw = await this._executeWithClaudeSdk(`${taskId}_evaluator`, null, evalPrompt, { folderPath: worktreePath, model: evaluatorModel });
                const evalResult = this._parseJsonSafely(evalRaw);
                if (evalResult.pass === true) {
                    isPassed = true;
                    logger.info(`[Master] 🎉 自治判定节点通过！代码合规。`);
                    this.emit('autonomous_passed', { taskId, attempts, timestamp: new Date() });
                }
                else {
                    logger.warn(`[Master] ❌ 自治判定未通过。缺陷原因: ${evalResult.reason}`);
                    this.emit('autonomous_failed', { taskId, attempts, reason: evalResult.reason, timestamp: new Date() });
                    // 增量需求反馈注入提示词，循环重新执行
                    currentPrompt = `你之前编写的代码未通过自动化机制审查。请根据以下反馈意见进行增量修改：\n\n【失败原因】：\n${evalResult.reason}\n\n【上一次你的产出】：\n${lastResult}`;
                }
            }
            if (!isPassed) {
                throw new Error(`[Master] 任务 ${taskId} 在达到最大自愈次数 ${maxAttempts} 后仍无法通过自治检测。`);
            }
            return lastResult;
        }
        finally {
            // 清理 worktree 空间
            await this._cleanupWorktreeWithLock(taskId, workspaceRoot);
        }
    }
    // ── Fork-Join 并行分叉与汇聚 ─────────────────────────────────
    /**
     * Fork-Join 并行执行：同时分发多个独立任务，完成后汇聚
     * @param tasks 并行任务数组
     * @param mergePrompt 汇聚提示词
     * @param workspaceRoot 工作区根目录
     * @returns 汇聚后的结果
     */
    async executeForkJoinFlow(tasks, mergePrompt, workspaceRoot) {
        logger.info(`[Master] 启动分叉流程：并行执行 ${tasks.length} 个子Agent`);
        // 1. 串行创建 worktree（带锁保护，防止 Git 锁死）
        const worktreePaths = new Map();
        for (const task of tasks) {
            const wt = await this._createWorktreeWithLock(task.id, workspaceRoot);
            worktreePaths.set(task.id, wt);
        }
        try {
            // 2. 物理并发运行所有子Agent，使用 p-limit 控制并发数
            const results = await Promise.all(tasks.map(task => this._agentLimit(() => this._executeWithClaudeSdk(task.id, null, task.description, {
                folderPath: worktreePaths.get(task.id),
                model: task.model
            }))));
            logger.info(`[Master] 并行任务全数运行完毕，启动汇聚处理节点`);
            // 3. 将所有成果拼接，作为上下文传给汇聚节点
            const joinPrompt = `
你现在的任务是汇总以下 ${tasks.length} 个并行任务的成果。

${tasks.map((task, i) => `【任务 ${task.id} 成果】：\n${results[i]}`).join('\n\n')}

【请执行以下整合任务】：
${mergePrompt}
`;
            // 启动汇聚节点进行最后的汇总与合并
            const mergeTaskId = `merge_${Date.now()}`;
            const finalResult = await this._executeWithClaudeSdk(mergeTaskId, null, joinPrompt, { folderPath: workspaceRoot });
            return finalResult;
        }
        finally {
            // 并发清理所有工作区（带锁保护）
            await Promise.all(tasks.map(task => this._cleanupWorktreeWithLock(task.id, workspaceRoot)));
        }
    }
    // ── HITL 人工审核（带反馈回滚）─────────────────────────────────
    /**
     * HITL 人工审核工作流：生成内容后等待人工确认，不通过则根据反馈重新生成
     * @param taskId 任务ID
     * @param initialPrompt 初始提示词
     * @param workspaceRoot 工作区根目录
     * @param approvalId 审批ID（用于前端交互）
     * @returns 最终结果
     */
    async executeHumanInTheLoopFlow(taskId, initialPrompt, workspaceRoot, approvalId) {
        logger.info(`[Master] 启动 [${taskId}] 的 HITL 人工审核工作流...`);
        let isApproved = false;
        let feedback = '';
        let lastResult = '';
        let attempts = 0;
        const maxAttempts = 10; // 防止无限循环
        // 创建本循环独占的 Worktree（带锁保护）
        const worktreePath = await this._createWorktreeWithLock(taskId, workspaceRoot);
        try {
            while (!isApproved && attempts < maxAttempts) {
                attempts++;
                const prompt = feedback
                    ? `你上一次编写的内容未通过人工审查。请根据以下反馈意见进行增量修改。\n\n【修改建议】:\n${feedback}\n\n【上一次你的产出】:\n${lastResult}`
                    : initialPrompt;
                logger.info(`[Master] HITL 第 ${attempts} 次尝试...`);
                // 1. 运行子Agent生成内容
                lastResult = await this._executeWithClaudeSdk(`${taskId}_hitl_${attempts}`, null, prompt, { folderPath: worktreePath });
                // 2. 广播审批请求
                const currentApprovalId = approvalId || `${taskId}_approval_${attempts}`;
                this._pendingApprovals.set(currentApprovalId, {
                    taskId,
                    result: lastResult,
                    attempts,
                    createdAt: new Date()
                });
                if (this.broadcastService) {
                    this.broadcastService.broadcast('workflow.approvalRequested', {
                        taskId,
                        approvalId: currentApprovalId,
                        result: lastResult,
                        attempts,
                        timestamp: new Date().toISOString()
                    });
                }
                // 3. 等待人工审批（通过Promise挂起）
                const approvalResult = await new Promise((resolve) => {
                    // 存储resolve函数，供外部调用
                    this._pendingApprovals.set(currentApprovalId, {
                        ...this._pendingApprovals.get(currentApprovalId),
                        resolve
                    });
                    // 设置审批超时（1小时）
                    setTimeout(() => {
                        if (this._pendingApprovals.has(currentApprovalId)) {
                            logger.warn(`[Master] HITL 审批超时，自动通过`, { taskId, approvalId: currentApprovalId });
                            this._pendingApprovals.delete(currentApprovalId);
                            resolve({ approved: true, feedback: '' });
                        }
                    }, 60 * 60 * 1000);
                });
                if (approvalResult.approved) {
                    isApproved = true;
                    logger.info(`[Master] HITL 审批通过`, { taskId, attempts });
                    this.emit('hitl_approved', { taskId, attempts, timestamp: new Date() });
                }
                else {
                    feedback = approvalResult.feedback || '请重新检查质量。';
                    logger.info(`[Master] HITL 审批未通过，反馈: ${feedback}`, { taskId, attempts });
                    this.emit('hitl_rejected', { taskId, attempts, feedback, timestamp: new Date() });
                }
            }
            if (!isApproved) {
                throw new Error(`[Master] 任务 ${taskId} 在达到最大审核次数 ${maxAttempts} 后仍未通过人工审核。`);
            }
            return lastResult;
        }
        finally {
            // 清理 worktree 空间
            await this._cleanupWorktreeWithLock(taskId, workspaceRoot);
        }
    }
    /**
     * 处理人工审批结果（由前端调用）
     */
    handleHitlApproval(approvalId, approved, feedback) {
        const approval = this._pendingApprovals.get(approvalId);
        if (!approval) {
            logger.warn(`[Master] HITL 审批ID不存在: ${approvalId}`);
            return;
        }
        if (approval.resolve) {
            approval.resolve({ approved, feedback: feedback || '' });
        }
        this._pendingApprovals.delete(approvalId);
    }
    /**
     * Execute via Anthropic SDK — streaming mode with Agent tool support
     */
    async execute(taskId, agentId, prompt, config = {}) {
        // 任务去重检查 - 使用 taskId 作为唯一标识，避免不同工作流实例被去重
        const taskForDedup = {
            taskId: taskId, // 使用 taskId 而不是任务内容
            description: prompt,
            model: config.model,
            allowedFiles: config.allowedFiles || []
        };
        if (this._isTaskDuplicate(taskForDedup)) {
            logger.info(`任务 ${taskId} 被去重跳过（已执行或正在执行）`);
            return {
                success: true,
                cached: true,
                message: '任务已执行过，跳过重复执行',
                taskId
            };
        }
        // 创建执行 Promise 并标记为正在执行
        const executionPromise = this._executeWithDedup(taskId, agentId, prompt, config);
        this._markTaskRunning(taskForDedup, executionPromise);
        return executionPromise;
    }
    async _executeWithDedup(taskId, agentId, prompt, config = {}) {
        const taskForDedup = {
            description: prompt,
            model: config.model,
            allowedFiles: config.allowedFiles || []
        };
        // 创建日志文件
        const logFile = path.join(LOGS_DIR, `run_${taskId}_${Date.now()}.log`);
        this._ensureLogDir();
        const logStream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf-8' });
        this._writeLog(logStream, `[STARTED] Task ${taskId}, Model: ${config.model || 'sonnet'}`);
        this._writeLog(logStream, `[PROMPT] ${String(prompt || '').substring(0, 500)}...`);
        const maxRetries = 3;
        let lastError = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // 使用每任务独立的熔断器，避免一个任务的故障影响其他任务
                const cb = this._getCircuitBreaker(taskId);
                // 使用 Claude Agent SDK 替代原生 Anthropic API
                const result = await cb.call(async () => this._executeWithClaudeSdk(taskId, agentId, prompt, config));
                // 标记任务完成
                this._markTaskCompleted(taskForDedup);
                this._writeLog(logStream, `[COMPLETED] Task ${taskId}`);
                logStream.end();
                // 任务完成，清理该任务的熔断器
                this._circuitBreakers.delete(taskId);
                return result;
            }
            catch (err) {
                lastError = err;
                const isNetworkError = NETWORK_ERRORS.some(code => err.message?.includes(code) || err.code === code);
                this._writeLog(logStream, `[ERROR] Attempt ${attempt}/${maxRetries}: ${err.message}`);
                if (attempt === maxRetries) {
                    // 最后一次尝试失败，捕获故障现场
                    this._captureCrashScene(taskId, logFile, err);
                    break;
                }
                // 网络错误延长重试间隔
                let delay;
                if (isNetworkError) {
                    delay = [5000, 15000, 30000][attempt - 1]; // 5s, 15s, 30s
                    logger.warn(`任务 ${taskId} 网络错误(${err.code || err.message})，${delay / 1000}秒后重试(${attempt}/${maxRetries})`);
                    this._writeLog(logStream, `[NETWORK_ERROR] Retry in ${delay / 1000}s`);
                }
                else {
                    delay = [1000, 3000, 5000][attempt - 1]; // 1s, 3s, 5s
                    logger.warn(`任务 ${taskId} 失败，${delay / 1000}秒后重试(${attempt}/${maxRetries})`);
                    this._writeLog(logStream, `[RETRY] Retry in ${delay / 1000}s`);
                }
                await new Promise(r => setTimeout(r, delay));
            }
        }
        // 失败时也从运行中移除（不标记为完成）
        const key = getTaskKey(taskForDedup);
        this._runningTasks.delete(key);
        // 清理该任务的熔断器
        this._circuitBreakers.delete(taskId);
        this._writeLog(logStream, `[FAILED] Task ${taskId} after ${maxRetries} attempts`);
        logStream.end();
        throw lastError;
    }
    /**
     * 确保日志目录存在
     */
    _ensureLogDir() {
        try {
            if (!fs.existsSync(LOGS_DIR)) {
                fs.mkdirSync(LOGS_DIR, { recursive: true });
            }
        }
        catch (e) { /* ignore */ }
    }
    /**
     * 写入日志
     */
    _writeLog(logStream, content) {
        try {
            logStream.write(`[${new Date().toISOString()}] ${content}\n`);
        }
        catch (e) { /* ignore */ }
    }
    /**
     * 捕获故障现场
     */
    _captureCrashScene(taskId, logFile, error) {
        try {
            const crashReport = `
========== 故障现场 ==========
时间: ${new Date().toISOString()}
任务ID: ${taskId}
错误类型: ${error.errorType || 'UNKNOWN'}
错误信息: ${error.message}
日志文件: ${logFile}
===============================
`;
            // 追加到日志文件
            fs.appendFileSync(logFile, crashReport);
            // 保存独立的故障报告
            const crashFile = path.join(LOGS_DIR, `crash_${taskId}_${Date.now()}.log`);
            fs.writeFileSync(crashFile, crashReport);
            logger.error(`任务 ${taskId} 故障现场已保存到 ${crashFile}`);
        }
        catch (e) {
            logger.warn(`捕获故障现场失败: ${taskId}`, e);
        }
    }
    async _executeInternal(taskId, agentId, prompt, config = {}) {
        if (config?.workflowId) {
            this._taskWorkflowMap.set(taskId, config.workflowId);
        }
        if (config?.runId || config?.nodeId) {
            this._taskMetaMap.set(taskId, {
                runId: config.runId || null,
                nodeId: config.nodeId || null
            });
        }
        // Set up execution context for checkpointing
        this._agentCallIndex = 0;
        this._executableNodes = config.executableNodes || [];
        this._checkpointCallback = config.onNodeComplete || null;
        this._nodeRegistry = config.nodeRegistry || {};
        const userSystemPrompt = config.systemPrompt || '';
        const modelAlias = config.model || 'sonnet';
        // 优先使用 config.folderPath，然后是 FileService.getWorkspaceRoot()，最后才是 process.cwd()
        const FileService = require('./FileService');
        const workingDir = config.folderPath || config.workingDir || FileService.getWorkspaceRoot() || process.cwd();
        const timeoutMs = config.timeoutMs || 30 * 60 * 1000; // 30 分钟超时（默认）
        // Get client config from default API Key config
        let clientConfig;
        try {
            clientConfig = ApiKeyService.getClientConfig();
        }
        catch (e) {
            throw new AppError('API_KEY_MISSING', e.message, 400);
        }
        // 使用 resolveModel 将别名转换为实际模型ID
        const model = ApiKeyService.resolveModel(modelAlias);
        // Build Anthropic client (all providers use Anthropic Messages API format)
        // 使用互斥锁防止并发调用丢失auth token
        const clientOpts = { apiKey: clientConfig.apiKey };
        if (clientConfig.baseUrl) {
            clientOpts.baseURL = clientConfig.baseUrl.replace(/\/+$/, '');
        }
        const client = await this._withEnvLock(async () => new Anthropic(clientOpts));
        logger.info(`SDK: Anthropic client, model=${model}, provider=${clientConfig.provider}${clientConfig.baseUrl ? ', baseURL=' + clientConfig.baseUrl : ''}`);
        // Build system prompt with sandbox rules
        const boundaryRule = `[关键安全规则 - 工作区沙箱]
你已被授予所有工具的完全权限，但必须在以下沙箱边界内运行：
工作区目录: "${workingDir}"

=== 硬约束（违反将导致任务失败） ===
1. 所有文件操作必须严格限制在工作区目录内。
2. 严禁访问工作区外的任何路径。
3. 严禁读取或修改以下系统目录：WORKFLOWS/、reports/、.context/、.BACKUP/
4. 创建文件时始终使用相对于工作区目录的路径。

=== 文件生成规则 ===
1. 必须使用 write_to_file 工具将所有内容保存为文件。
2. 文件名要清晰描述内容。
3. 多步骤任务将中间结果保存为独立文件。

[错误处理]
如果遇到错误：记录到文件并继续，不要静默忽略。`;
        const systemPrompt = userSystemPrompt
            ? `${boundaryRule}\n\n${userSystemPrompt}`
            : boundaryRule;
        logger.info('SDK execution started', { taskId, agentId, model: `${clientConfig.provider}:${model}` });
        // Snapshot before execution
        const filesBefore = this._getFilesSnapshot(workingDir);
        // Build tool definitions for multi-agent orchestration
        const tools = this._buildTools(workingDir);
        this.activeStreams.set(taskId, { abortController: new AbortController(), startedAt: new Date() });
        let output = '';
        const abortSignal = this.activeStreams.get(taskId)?.abortController?.signal;
        // 确保 prompt 是字符串
        const safePrompt = String(prompt || '执行分配的任务');
        return new Promise((resolve, reject) => {
            // Use the SDK's streaming API
            this._runAgentLoop(client, model, systemPrompt, safePrompt, tools, taskId, agentId, workingDir, timeoutMs, abortSignal)
                .then(async (result) => {
                this.activeStreams.delete(taskId);
                this._taskWorkflowMap.delete(taskId);
                this._taskMetaMap?.delete(taskId);
                if (result.error) {
                    if (result.error.type === 'PAUSED') {
                        resolve('[PAUSED] ' + (output || ''));
                        return;
                    }
                    // Classify error
                    const errorInfo = this._classifySdkError(result.error);
                    const err = new AppError(errorInfo.type, errorInfo.message, errorInfo.statusCode);
                    err.errorType = errorInfo.type;
                    err.retryable = errorInfo.retryable;
                    reject(err);
                    return;
                }
                output = result.text;
                // Detect new files
                const filesAfter = this._getFilesSnapshot(workingDir);
                const newFiles = [];
                for (const f of filesAfter) {
                    if (!filesBefore.has(f)) {
                        newFiles.push({ name: f, path: path.join(workingDir, f) });
                    }
                }
                if (newFiles.length > 0 && this.broadcastService) {
                    this.broadcastService.broadcast('files.generated', {
                        taskId, agentId, workspaceDir: workingDir,
                        newFiles, misplacedFiles: [],
                        timestamp: new Date().toISOString()
                    });
                }
                // Complete signal
                this._broadcastChunk(taskId, agentId, '', true);
                logger.info('SDK execution completed', { taskId, outputLength: output.length, newFiles: newFiles.length });
                resolve(output);
            });
        });
    }
    /**
     * 使用 Claude Agent SDK 执行任务（替代原生 Anthropic API）
     * 解决主Agent不知道子Agent已完成的问题
     */
    async _executeWithClaudeSdk(taskId, agentId, prompt, config = {}, retryCount = 0) {
        if (config?.workflowId) {
            this._taskWorkflowMap.set(taskId, config.workflowId);
        }
        if (config?.runId || config?.nodeId) {
            this._taskMetaMap.set(taskId, {
                runId: config.runId || null,
                nodeId: config.nodeId || null
            });
        }
        // Set up execution context for checkpointing
        this._agentCallIndex = 0;
        this._executableNodes = config.executableNodes || [];
        this._checkpointCallback = config.onNodeComplete || null;
        this._nodeRegistry = config.nodeRegistry || {};
        const userSystemPrompt = config.systemPrompt || '';
        const modelAlias = config.model || 'sonnet';
        const FileService = require('./FileService');
        const workingDir = config.folderPath || config.workingDir || FileService.getWorkspaceRoot() || process.cwd();
        // 使用 resolveModel 将别名转换为实际模型ID
        const resolvedModel = ApiKeyService.resolveModel(modelAlias);
        // 读取Claude CLI配置中的环境变量
        let claudeEnv = {};
        try {
            const settingsPath = path.join(require('os').homedir(), '.claude', 'settings.json');
            if (fs.existsSync(settingsPath)) {
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
                if (settings.env) {
                    claudeEnv = settings.env;
                }
            }
        }
        catch (e) {
            logger.warn('Failed to read Claude CLI settings:', e);
        }
        // Build system prompt
        const systemPrompt = userSystemPrompt || '执行分配的任务';
        logger.info('SDK execution started (using Claude Agent SDK)', { taskId, agentId, model: resolvedModel, cwd: workingDir });
        // 发送任务启动事件
        this.emit('task_started', { taskId, agentId, model: resolvedModel, cwd: workingDir, timestamp: new Date() });
        // Snapshot before execution
        const filesBefore = this._getFilesSnapshot(workingDir);
        this.activeStreams.set(taskId, { abortController: new AbortController(), startedAt: new Date() });
        let output = '';
        const abortController = this.activeStreams.get(taskId)?.abortController;
        // 确保 prompt 是字符串 - 如果为空，使用系统提示词中的任务描述
        const safePrompt = String(prompt || '请按照系统提示词中的步骤执行工作流任务');
        try {
            // 使用 Claude Agent SDK 的 query 函数
            const { query } = require('@anthropic-ai/claude-agent-sdk');
            // 检查是否需要审批节点支持
            const hasApprovalNode = this._executableNodes.some(n => n.type === 'approval');
            const pendingApprovals = this._pendingApprovals;
            // 获取 Agent 安装的技能
            const SkillService = require('./SkillService');
            const agentSkills = agentId ? SkillService.getSkillIdsByAgent(agentId) : [];
            const nodeSkills = config?.skills || config?.skillNames || [];
            const allSkills = [...new Set([...agentSkills, ...nodeSkills])];
            const queryOptions = {
                cwd: workingDir,
                model: resolvedModel,
                systemPrompt: systemPrompt,
                permissionMode: 'bypassPermissions',
                maxTurns: 50,
                allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
                signal: abortController?.signal, // 使用 signal 替代 abortController，实现物理级控制
                env: { ...process.env, ...claudeEnv },
                // 启用技能（CLI 自动发现 .claude/skills/ 下的 SKILL.md）
                skills: allSkills.length > 0 ? allSkills : undefined,
                // PreToolUse Hook - 安全拦截和审批支持
                hooks: {
                    PreToolUse: [{
                            matcher: ".*", // 匹配所有工具调用
                            callback: async (input) => {
                                return await this._handlePreToolUse(taskId, input, hasApprovalNode, pendingApprovals);
                            }
                        }],
                    PostToolUse: [{
                            matcher: ".*",
                            callback: async (input) => {
                                // 记录工具执行结果
                                logger.info(`[SdkService] 工具执行完成: ${input.tool_name}`, {
                                    taskId,
                                    toolName: input.tool_name,
                                    hasOutput: !!input.tool_output
                                });
                                // 记录到调用树（级联追踪）
                                this._trackToolCall(taskId, input.tool_name, input.tool_input, input.parent_tool_use_id, input.session_id);
                                // 广播工具执行事件（用于前端实时监控）
                                this.emit('tool_executed', {
                                    taskId,
                                    agentId,
                                    toolName: input.tool_name,
                                    toolInput: input.tool_input,
                                    toolOutput: input.tool_output,
                                    // 级联调用追踪字段
                                    parentToolUseId: input.parent_tool_use_id || null,
                                    sessionId: input.session_id || null,
                                    timestamp: new Date()
                                });
                                // 广播到WebSocket（前端实时显示）
                                if (this.broadcastService) {
                                    this.broadcastService.broadcast('agent.tool_executed', {
                                        taskId,
                                        agentId,
                                        toolName: input.tool_name,
                                        toolInput: typeof input.tool_input === 'object' ? JSON.stringify(input.tool_input).substring(0, 500) : String(input.tool_input || '').substring(0, 500),
                                        hasOutput: !!input.tool_output,
                                        parentToolUseId: input.parent_tool_use_id || null,
                                        sessionId: input.session_id || null,
                                        timestamp: new Date().toISOString()
                                    });
                                }
                                return {};
                            }
                        }]
                }
            };
            logger.info(`[SdkService] 开始SDK调用, model=${resolvedModel}, cwd=${workingDir}, prompt长度=${safePrompt.length}, 审批节点=${hasApprovalNode}`);
            for await (const message of query({
                prompt: safePrompt,
                options: queryOptions
            })) {
                // 检查是否被终止
                if (abortController?.signal?.aborted) {
                    const reason = abortController.signal.reason || 'CANCELLED';
                    logger.info(`Task ${taskId} aborted: ${reason}`);
                    throw new Error(reason);
                }
                // 处理assistant消息
                if (message.type === 'assistant') {
                    const content = message.message?.content || [];
                    for (const block of content) {
                        if (block.type === 'text' && block.text) {
                            output += block.text;
                            this._broadcastChunk(taskId, agentId, block.text, false);
                            // 发送进度事件
                            this.emit('progress', { taskId, agentId, text: block.text, timestamp: new Date() });
                        }
                        // 解析工具调用（tool_use块）
                        else if (block.type === 'tool_use') {
                            const toolName = block.name;
                            const toolInput = block.input || {};
                            const toolUseId = block.id;
                            logger.info(`[SdkService] 工具调用: ${toolName}`, {
                                taskId,
                                toolUseId,
                                toolInput: JSON.stringify(toolInput).substring(0, 200)
                            });
                            // 记录到调用树
                            this._trackToolCall(taskId, toolName, toolInput);
                            // 广播工具调用事件（前端实时监控）
                            this.emit('tool_use', {
                                taskId,
                                agentId,
                                toolName,
                                toolInput,
                                toolUseId,
                                timestamp: new Date()
                            });
                            // 广播到WebSocket
                            if (this.broadcastService) {
                                this.broadcastService.broadcast('agent.tool_use', {
                                    taskId,
                                    agentId,
                                    toolName,
                                    toolInput: JSON.stringify(toolInput).substring(0, 500),
                                    toolUseId,
                                    timestamp: new Date().toISOString()
                                });
                            }
                        }
                        // 解析工具结果（tool_result块）
                        else if (block.type === 'tool_result') {
                            const toolUseId = block.tool_use_id;
                            const toolResult = block.content || '';
                            logger.info(`[SdkService] 工具结果`, {
                                taskId,
                                toolUseId,
                                resultLength: typeof toolResult === 'string' ? toolResult.length : JSON.stringify(toolResult).length
                            });
                            // 广播工具结果事件
                            this.emit('tool_result', {
                                taskId,
                                agentId,
                                toolUseId,
                                toolResult: typeof toolResult === 'string' ? toolResult.substring(0, 1000) : JSON.stringify(toolResult).substring(0, 1000),
                                timestamp: new Date()
                            });
                            // 广播到WebSocket
                            if (this.broadcastService) {
                                this.broadcastService.broadcast('agent.tool_result', {
                                    taskId,
                                    agentId,
                                    toolUseId,
                                    hasResult: !!toolResult,
                                    timestamp: new Date().toISOString()
                                });
                            }
                        }
                    }
                }
                // 处理result消息
                else if (message.type === 'result') {
                    logger.info(`[SdkService] result: ${message.subtype}`);
                    if (message.subtype === 'success' && message.result) {
                        output = message.result || output;
                        // 发送任务完成事件
                        this.emit('completed', { taskId, agentId, result: output, timestamp: new Date() });
                    }
                    else if (message.subtype === 'error') {
                        throw new Error(message.error || 'SDK execution failed');
                    }
                    else if (message.subtype === 'error_max_turns') {
                        logger.warn(`[SdkService] 任务 ${taskId} 达到最大轮次限制 (50轮)`);
                        // 使用已有 output，不抛错（工作流可以继续用部分结果）
                        if (!output && message.result) {
                            output = message.result;
                        }
                        this.emit('completed', { taskId, agentId, result: output || '(达到轮次限制，部分完成)', timestamp: new Date() });
                    }
                }
            }
            // 清理
            this.activeStreams.delete(taskId);
            this._taskWorkflowMap.delete(taskId);
            this._taskMetaMap?.delete(taskId);
            // 清理调用树（任务完成后）
            this._cleanupCallingTree(taskId);
            // Get file changes after execution
            const filesAfter = this._getFilesSnapshot(workingDir);
            const newFiles = [];
            for (const f of filesAfter) {
                if (!filesBefore.has(f)) {
                    newFiles.push({ name: f, path: path.join(workingDir, f) });
                }
            }
            if (newFiles.length > 0 && this.broadcastService) {
                this.broadcastService.broadcast('files.generated', {
                    taskId, agentId, workspaceDir: workingDir,
                    newFiles, misplacedFiles: [],
                    timestamp: new Date().toISOString()
                });
            }
            // Complete signal
            this._broadcastChunk(taskId, agentId, '', true);
            logger.info('SDK execution completed (Claude Agent SDK)', { taskId, outputLength: output.length, newFiles: newFiles.length });
            return output || 'Task completed.';
        }
        catch (err) {
            // 清理
            this.activeStreams.delete(taskId);
            this._taskWorkflowMap.delete(taskId);
            this._taskMetaMap?.delete(taskId);
            this._cleanupCallingTree(taskId);
            // 发送任务失败事件
            this.emit('failed', { taskId, agentId, error: err.message, timestamp: new Date() });
            // 429错误：指数退避重试（最多3次）
            const MAX_RETRIES = 3;
            if ((err.status === 429 || err.message?.includes('429') || err.message?.includes('Too many requests')) && retryCount < MAX_RETRIES) {
                const retryDelay = Math.min(5000 * Math.pow(2, retryCount), 30000);
                logger.warn(`Task ${taskId} hit rate limit (attempt ${retryCount + 1}/${MAX_RETRIES}), retrying in ${retryDelay / 1000}s`);
                this._broadcastChunk(taskId, agentId, `\n[等待API恢复 ${retryDelay / 1000}秒 (尝试 ${retryCount + 1}/${MAX_RETRIES})...]\n`, false);
                await new Promise(r => setTimeout(r, retryDelay));
                return this._executeWithClaudeSdk(taskId, agentId, prompt, config, retryCount + 1);
            }
            logger.error(`Task ${taskId} failed`, { error: err.message });
            throw err;
        }
    }
    /**
     * PreToolUse Hook 处理器 - 安全拦截和审批支持
     * 根据实现方案文档，这是唯一可以"阻断"和"改写"工具执行的异步拦截器
     */
    async _handlePreToolUse(taskId, input, hasApprovalNode, pendingApprovals) {
        const toolName = input.tool_name;
        const toolInput = input.tool_input || {};
        logger.info(`[SdkService] PreToolUse Hook: ${toolName}`, { taskId, toolInput: JSON.stringify(toolInput).substring(0, 200) });
        // 广播安全检查事件（用于前端实时监控）
        this.emit('security_check', {
            taskId,
            toolName,
            toolInput,
            // 级联调用追踪字段
            parentToolUseId: input.parent_tool_use_id || null,
            sessionId: input.session_id || null,
            timestamp: new Date()
        });
        // 广播到WebSocket（前端实时显示）
        if (this.broadcastService) {
            this.broadcastService.broadcast('agent.security_check', {
                taskId,
                toolName,
                toolInput: typeof toolInput === 'object' ? JSON.stringify(toolInput).substring(0, 500) : String(toolInput).substring(0, 500),
                parentToolUseId: input.parent_tool_use_id || null,
                sessionId: input.session_id || null,
                timestamp: new Date().toISOString()
            });
        }
        // 1. 安全拦截 - 阻止危险命令
        if (toolName === 'Bash') {
            const command = String(toolInput.command || '');
            const dangerousPatterns = [
                /rm\s+-rf\s+[\/\\]/, // rm -rf /
                /mkfs/, // 格式化磁盘
                /dd\s+if=.*of=\/dev/, // dd 写入设备
                /:(){ :\|:& };:/, // fork bomb
                /chmod\s+777/, // 危险权限
            ];
            for (const pattern of dangerousPatterns) {
                if (pattern.test(command)) {
                    logger.warn(`[SdkService] 安全拦截: 阻止危险命令`, { taskId, command });
                    this._broadcastChunk(taskId, null, `\n[安全拦截] 命令被阻止: ${command}\n`, false);
                    // 广播拦截事件
                    if (this.broadcastService) {
                        this.broadcastService.broadcast('agent.tool_blocked', {
                            taskId,
                            toolName,
                            command,
                            reason: 'dangerous_command',
                            timestamp: new Date().toISOString()
                        });
                    }
                    return { hookSpecificOutput: { permissionDecision: 'deny' } };
                }
            }
        }
        // 2. 审批节点支持 - 如果工作流包含审批节点，需要人工确认
        if (hasApprovalNode && this._isApprovalRequired(toolName, toolInput)) {
            logger.info(`[SdkService] 审批请求: ${toolName}`, { taskId });
            // 广播审批请求
            if (this.broadcastService) {
                this.broadcastService.broadcast('workflow.approvalRequested', {
                    taskId,
                    toolName,
                    toolInput,
                    timestamp: new Date().toISOString()
                });
            }
            // 创建Promise等待审批结果
            return new Promise((resolve) => {
                const approvalId = `${taskId}_${Date.now()}`;
                pendingApprovals.set(approvalId, {
                    taskId,
                    toolName,
                    toolInput,
                    resolve,
                    createdAt: new Date()
                });
                // 设置审批超时（5分钟）
                setTimeout(() => {
                    if (pendingApprovals.has(approvalId)) {
                        logger.warn(`[SdkService] 审批超时，自动拒绝`, { taskId, approvalId });
                        pendingApprovals.delete(approvalId);
                        resolve({ hookSpecificOutput: { permissionDecision: 'deny' } });
                    }
                }, 5 * 60 * 1000);
            });
        }
        // 3. 默认允许
        return { hookSpecificOutput: { permissionDecision: 'allow' } };
    }
    /**
     * 判断是否需要审批
     */
    _isApprovalRequired(toolName, toolInput) {
        // 审批节点的工具调用需要人工确认
        // 这里可以根据业务逻辑自定义
        return false;
    }
    /**
     * 处理审批结果（由前端调用）
     */
    handleApprovalResult(approvalId, approved, feedback) {
        const approval = this._pendingApprovals.get(approvalId);
        if (!approval) {
            logger.warn(`[SdkService] 审批ID不存在: ${approvalId}`);
            return;
        }
        this._pendingApprovals.delete(approvalId);
        if (approved) {
            logger.info(`[SdkService] 审批通过`, { approvalId });
            approval.resolve({ hookSpecificOutput: { permissionDecision: 'allow' } });
        }
        else {
            logger.info(`[SdkService] 审批拒绝`, { approvalId, feedback });
            // 如果有反馈，可以注入到下一次执行中
            approval.resolve({ hookSpecificOutput: { permissionDecision: 'deny' } });
        }
    }
    /**
     * Multi-turn agent loop with tool calling support
     * Implements the Agent tool for sub-agent delegation
     */
    async _runAgentLoop(client, model, systemPrompt, userPrompt, tools, taskId, agentId, workingDir, timeoutMs, abortSignal) {
        const messages = [{ role: 'user', content: userPrompt }];
        let fullText = '';
        const startTime = Date.now();
        // Track background agent tasks
        const backgroundTasks = [];
        // 步骤计数器，防止无限循环
        let stepCount = 0;
        const maxSteps = 50; // 最大步骤数
        const toolCallHistory = []; // 记录工具调用历史，检测重复
        while (true) {
            // Check timeout
            if (Date.now() - startTime > timeoutMs) {
                return { error: { type: 'TIMEOUT', message: 'SDK execution timed out (60 minutes)' } };
            }
            if (abortSignal?.aborted) {
                const reason = abortSignal.reason || 'CANCELLED';
                return { error: { type: reason, message: reason === 'PAUSED' ? 'Execution paused' : 'Execution cancelled' } };
            }
            // 步骤计数器，防止无限循环
            stepCount++;
            if (stepCount > maxSteps) {
                logger.warn(`Agent loop exceeded max steps (${maxSteps}), forcing exit`, { taskId });
                return { text: fullText + '\n\n[系统] 已达到最大步骤数限制，强制结束。', error: null };
            }
            // 每次API调用独立的AbortController，5分钟超时防止单次请求挂起
            const requestAbortController = new AbortController();
            let requestTimeoutId;
            try {
                // ── 流式模式 ──
                // 使用 Anthropic SDK 的流式 API，实时推送每个 token
                // 这不会增加 token 消耗，只是改变了传输方式
                logger.info(`SDK API call starting`, { taskId, model, messageCount: messages.length, stepCount });
                requestTimeoutId = setTimeout(() => requestAbortController.abort(), 5 * 60 * 1000);
                const stream = await client.messages.create({
                    model,
                    system: [{ type: 'text', text: systemPrompt }],
                    messages,
                    tools,
                    max_tokens: 16000,
                    stream: true, // 启用流式模式
                    signal: requestAbortController.signal,
                });
                logger.info(`SDK API call returned stream`, { taskId });
                const content = [];
                let currentText = '';
                let currentToolInputJson = ''; // 累积工具输入的 JSON 字符串
                // 处理流式响应
                for await (const event of stream) {
                    if (event.type === 'content_block_delta') {
                        const delta = event.delta;
                        if (delta.type === 'text_delta') {
                            currentText += delta.text;
                            // 实时推送文本块
                            this._broadcastChunk(taskId, agentId, delta.text, false);
                        }
                        else if (delta.type === 'input_json_delta') {
                            // 工具输入的增量 JSON
                            currentToolInputJson += delta.partial_json;
                        }
                    }
                    else if (event.type === 'content_block_start') {
                        const block = event.content_block;
                        if (block.type === 'tool_use') {
                            // 工具输入在 content_block_start 时不可用，需要通过 delta 累积
                            currentToolInputJson = '';
                            content.push({
                                type: 'tool_use',
                                id: block.id,
                                name: block.name,
                                input: {}, // 占位，稍后通过 delta 更新
                            });
                        }
                        else if (block.type === 'text') {
                            content.push({
                                type: 'text',
                                text: '',
                            });
                        }
                    }
                    else if (event.type === 'content_block_stop') {
                        const lastBlock = content[content.length - 1];
                        if (lastBlock) {
                            if (lastBlock.type === 'text') {
                                lastBlock.text = currentText;
                                fullText += currentText;
                                currentText = '';
                            }
                            else if (lastBlock.type === 'tool_use') {
                                // 解析累积的工具输入 JSON
                                try {
                                    if (currentToolInputJson) {
                                        lastBlock.input = JSON.parse(currentToolInputJson);
                                    }
                                }
                                catch (e) {
                                    logger.warn('Failed to parse tool input JSON', { error: e.message, json: currentToolInputJson });
                                }
                                currentToolInputJson = '';
                            }
                        }
                    }
                    else if (event.type === 'message_delta') {
                        // 检查停止原因
                        const stopReason = event.delta.stop_reason;
                        if (stopReason === 'end_turn') {
                            break;
                        }
                    }
                }
                // 清除本次请求的超时定时器
                clearTimeout(requestTimeoutId);
                // 检测完成信号 - 只在最新一轮输出中检测，避免子Agent输出误触发
                // 只有当最新一轮输出包含完成信号时才退出
                if (currentText.includes('[文件清单]') || currentText.includes('[执行摘要]')) {
                    logger.info('Detected completion signal in current round, exiting loop', { taskId });
                    return { text: fullText, error: null };
                }
                // 处理工具调用
                const toolBlocks = content.filter(block => block.type === 'tool_use');
                if (toolBlocks.length > 0) {
                    const toolResults = [];
                    for (const block of toolBlocks) {
                        // 检测重复调用
                        const callKey = `${block.name}_${JSON.stringify(block.input)}`;
                        if (toolCallHistory.includes(callKey)) {
                            logger.warn(`检测到重复工具调用: ${block.name}`, { taskId });
                            toolResults.push({
                                type: 'tool_result',
                                tool_use_id: block.id,
                                content: `警告: 此工具调用已经被执行过，请不要重复调用。`
                            });
                            continue;
                        }
                        toolCallHistory.push(callKey);
                        const toolResult = await this._handleToolCall(block, client, taskId, workingDir, tools, backgroundTasks, 0);
                        toolResults.push(toolResult);
                        // Save checkpoint immediately after each named Agent call completes
                        // Use node ID from tool name (Agent_n2 -> n2) instead of sequential index
                        // to avoid misalignment if model skips or reorders tool calls
                        if (block.name && block.name.startsWith('Agent_') && this._checkpointCallback) {
                            const nodeId = block.name.substring(6); // Extract node ID from "Agent_nX"
                            const nodeInfo = this._nodeRegistry[nodeId];
                            if (nodeInfo) {
                                this._checkpointCallback(nodeId, nodeInfo.label || nodeId, toolResult?.content || '');
                            }
                        }
                    }
                    // Add assistant message to history
                    messages.push({ role: 'assistant', content });
                    messages.push({ role: 'user', content: toolResults });
                    continue;
                }
                // max_tokens — continue
                messages.push({ role: 'assistant', content });
                messages.push({ role: 'user', content: [{ type: 'text', text: 'Please continue.' }] });
                continue;
            }
            catch (err) {
                // 清除请求超时定时器
                clearTimeout(requestTimeoutId);
                logger.error(`SDK API error: ${err.message}`, { status: err.status, code: err.code });
                // 429错误：等待后重试
                if (err.status === 429 || err.message?.includes('429') || err.message?.includes('Too many requests')) {
                    const retryDelay = 5000; // 等待5秒
                    logger.warn(`主Agent遇到429限流，${retryDelay / 1000}秒后重试`);
                    this._broadcastChunk(taskId, agentId, `\n[等待API恢复 ${retryDelay / 1000}秒...]\n`, false);
                    await new Promise(r => setTimeout(r, retryDelay));
                    continue; // 重试
                }
                const errorInfo = this._classifySdkError(err);
                return { error: { type: errorInfo.type, message: errorInfo.message, statusCode: errorInfo.statusCode, retryable: errorInfo.retryable, raw: err } };
            }
        }
        // Wait for background tasks to complete
        if (backgroundTasks.length > 0) {
            const bgResults = await Promise.allSettled(backgroundTasks.map(t => t.promise));
            for (let i = 0; i < bgResults.length; i++) {
                const result = bgResults[i];
                const task = backgroundTasks[i];
                if (result.status === 'fulfilled') {
                    const resultValue = String(result.value || '');
                    fullText += `\n\n[后台子Agent "${task.description}" 完成]\n${resultValue.substring(0, 2000)}`;
                    this._broadcastChunk(taskId, agentId, `\n[后台子Agent "${task.description}" 完成]\n`, false);
                }
                else {
                    fullText += `\n\n[后台子Agent "${task.description}" 失败: ${result.reason?.message}]\n`;
                }
            }
        }
        return { text: fullText, error: null };
    }
    /**
     * Handle individual tool calls from the agent
     */
    async _handleToolCall(toolUseBlock, client, taskId, workingDir, tools, backgroundTasks, depth = 0) {
        const toolName = toolUseBlock.name;
        const toolInput = toolUseBlock.input || {};
        const toolId = toolUseBlock.id;
        // ── Named Agent tools (Agent_n2, Agent_n3, ...) ──
        // 使用 SDK 模式实现子Agent，支持真正的并行执行和生命周期管理
        if (toolName && toolName.startsWith('Agent_')) {
            const nodeId = toolName.substring(6);
            const nodeInfo = this._nodeRegistry[nodeId];
            if (!nodeInfo) {
                return { type: 'tool_result', tool_use_id: toolId, content: `未知的子Agent: ${toolName}。可用: ${Object.keys(this._nodeRegistry).map(id => 'Agent_' + id).join(', ')}` };
            }
            const subTask = toolInput.task || toolInput.prompt || nodeInfo.task || '执行分配的任务';
            const subModel = nodeInfo.model || 'sonnet';
            const subSystemPrompt = nodeInfo.systemPrompt || nodeInfo.rolePrompt || '';
            const runInBackground = toolInput.run_in_background === true;
            const agentType = nodeInfo.agentType || 'general';
            // ── 权限：Explore 只读，general-purpose 完整 ──
            const isReadOnly = agentType === 'Explore';
            const derivedPermissions = { read: true, write: !isReadOnly, execute: !isReadOnly, search: true };
            // ── 系统提示 ──
            let sdkSystemPrompt = subSystemPrompt || '';
            if (!sdkSystemPrompt) {
                sdkSystemPrompt = `你是一个专业的 ${nodeInfo.label || '执行者'}。`;
            }
            // 添加技能和 MCP 工具信息
            const skills = nodeInfo.skills;
            const mcp = nodeInfo.mcp;
            if (skills && skills.length > 0) {
                sdkSystemPrompt += `\n\n[可用技能]\n${skills.join('\n')}`;
            }
            if (mcp && mcp.length > 0) {
                sdkSystemPrompt += `\n\n[外部工具]\n${mcp.join('\n')}`;
            }
            // 添加权限信息到系统提示
            const permEntries = Object.entries(derivedPermissions);
            if (permEntries.length > 0) {
                const allowed = permEntries.filter(([, v]) => v).map(([k]) => k);
                const denied = permEntries.filter(([, v]) => !v).map(([k]) => k);
                if (allowed.length > 0 || denied.length > 0) {
                    sdkSystemPrompt += `\n\n[权限配置]`;
                    if (allowed.length > 0) {
                        sdkSystemPrompt += `\n✓ 允许: ${allowed.join(', ')}`;
                    }
                    if (denied.length > 0) {
                        sdkSystemPrompt += `\n✗ 禁止: ${denied.join(', ')}`;
                    }
                }
            }
            const meta = this._taskMetaMap.get(taskId) || {};
            const subCallId = `${taskId}_${nodeId}_${Date.now()}`;
            if (runInBackground) {
                // 并行节点：使用SDK模式启动子Agent
                const bgPromise = this._spawnSdkAgent(subCallId, nodeId, nodeInfo, subTask, subModel, sdkSystemPrompt, workingDir, meta, derivedPermissions);
                backgroundTasks.push({ description: nodeInfo.label, promise: bgPromise });
                return {
                    type: 'tool_result',
                    tool_use_id: toolId,
                    content: `后台子Agent "${nodeInfo.label}" 已启动 (model: ${subModel}, 类型: ${agentType})。等待并行任务完成后汇总结果。`,
                };
            }
            this._broadcastChunk(taskId, null, `\n[启动: ${nodeInfo.label} (${subModel}, 类型: ${agentType})]\n`, false);
            try {
                const subResult = await this._spawnSdkAgent(subCallId, nodeId, nodeInfo, subTask, subModel, sdkSystemPrompt, workingDir, meta, derivedPermissions);
                this._broadcastChunk(taskId, null, `\n[完成: ${nodeInfo.label}]\n`, false);
                return {
                    type: 'tool_result',
                    tool_use_id: toolId,
                    content: this._formatSubagentResult(nodeId, nodeInfo.label, subResult),
                };
            }
            catch (err) {
                logger.error(`Sub-agent ${nodeInfo.label} failed`, { error: err.message, nodeId });
                this._broadcastChunk(taskId, null, `\n[失败: ${nodeInfo.label}] ${err.message}\n`, false);
                return {
                    type: 'tool_result',
                    tool_use_id: toolId,
                    is_error: true,
                    content: `子Agent "${nodeInfo.label}" 执行失败: ${err.message}\n\n请根据错误信息决定下一步操作：\n1. 如果是临时错误，可以重试\n2. 如果是任务问题，可以调整任务描述后重试\n3. 如果是不可恢复的错误，可以跳过此步骤`,
                };
            }
        }
        switch (toolName) {
            // ── Generic Agent tool (fallback) ──
            case 'Agent': {
                if (depth >= this._maxAgentDepth) {
                    return { type: 'tool_result', tool_use_id: toolId, content: 'Error: Agent nesting depth exceeded (max 3 levels). Please complete this task directly.' };
                }
                // Delegate task to a sub-agent with full capabilities
                const subDescription = toolInput.description || 'Sub-agent task';
                const subPrompt = toolInput.prompt || toolInput.task || '';
                const subModel = toolInput.model || 'sonnet';
                const runInBackground = toolInput.run_in_background === true;
                if (runInBackground) {
                    const bgPromise = this._runSubAgent(client, taskId, subDescription, subPrompt, subModel, workingDir, depth + 1);
                    backgroundTasks.push({ description: subDescription, promise: bgPromise });
                    return {
                        type: 'tool_result',
                        tool_use_id: toolId,
                        content: `后台子Agent "${subDescription}" 已启动，使用模型 ${subModel}。完成后结果将自动合并。`
                    };
                }
                // Foreground: run and wait
                this._broadcastChunk(taskId, null, `\n[启动子Agent: ${subDescription}]\n`, false);
                const subResult = await this._runSubAgent(client, taskId, subDescription, subPrompt, subModel, workingDir, depth + 1);
                this._broadcastChunk(taskId, null, `\n[子Agent "${subDescription}" 完成]\n`, false);
                return {
                    type: 'tool_result',
                    tool_use_id: toolId,
                    content: String(subResult || '').substring(0, 16000) // Truncate to fit context
                };
            }
            case 'request_approval': {
                // Pause execution and request human approval via WebSocket
                const approvalTitle = toolInput.title || '审核请求';
                const approvalDesc = toolInput.description || '';
                const approvalContent = toolInput.content || '';
                const approvalRequestId = require('uuid').v4();
                const workflowId = this._taskWorkflowMap.get(taskId) || null;
                const meta = this._taskMetaMap.get(taskId) || {};
                if (this.broadcastService) {
                    // 广播审批请求（兼容两种频道名称）
                    const approvalPayload = {
                        workflowId,
                        runId: meta.runId || null,
                        nodeId: meta.nodeId || null,
                        approvalRequestId,
                        title: approvalTitle,
                        description: approvalDesc,
                        context: approvalContent,
                        timeout: 3600,
                        timestamp: new Date().toISOString()
                    };
                    this.broadcastService.broadcast('workflow.approvalRequested', approvalPayload);
                    this.broadcastService.broadcast('workflow.humanIntervention', approvalPayload);
                }
                this._broadcastChunk(taskId, null, `\n[审核请求: ${approvalTitle}] 等待人工审核...\n`, false);
                // Wait for approval via promise (timeout 1 hour)
                const result = await new Promise((resolve) => {
                    const timer = setTimeout(() => {
                        this._pendingApprovals.delete(approvalRequestId);
                        resolve({ approved: false, comment: '审核超时' });
                    }, 3600 * 1000);
                    this._pendingApprovals.set(approvalRequestId, { resolve, timer });
                });
                if (result.approved) {
                    this._broadcastChunk(taskId, null, `[审核通过] ${result.comment || ''}\n`, false);
                    return {
                        type: 'tool_result',
                        tool_use_id: toolId,
                        content: `审核已通过${result.comment ? ': ' + result.comment : ''}。请继续执行后续步骤。`
                    };
                }
                else {
                    this._broadcastChunk(taskId, null, `[审核拒绝] ${result.comment || ''}\n`, false);
                    return {
                        type: 'tool_result',
                        tool_use_id: toolId,
                        content: `审核被拒绝${result.comment ? ': ' + result.comment : ''}。请根据拒绝原因调整后重试，或跳过相关步骤。`
                    };
                }
            }
            case 'read_file': {
                try {
                    const filePath = path.resolve(workingDir, toolInput.file_path || toolInput.path || '');
                    if (!filePath.startsWith(workingDir)) {
                        return { type: 'tool_result', tool_use_id: toolId, content: 'Error: File path outside workspace' };
                    }
                    const content = await fsPromises.readFile(filePath, 'utf-8');
                    const offset = toolInput.offset || 0;
                    const limit = toolInput.limit || content.length;
                    const sliced = content.slice(offset, offset + limit);
                    return { type: 'tool_result', tool_use_id: toolId, content: sliced };
                }
                catch (e) {
                    return { type: 'tool_result', tool_use_id: toolId, content: `Error reading file: ${e.message}` };
                }
            }
            case 'write_to_file': {
                try {
                    const filePath = path.resolve(workingDir, toolInput.file_path || toolInput.path || '');
                    if (!filePath.startsWith(workingDir)) {
                        return { type: 'tool_result', tool_use_id: toolId, content: 'Error: File path outside workspace' };
                    }
                    const dir = path.dirname(filePath);
                    await fsPromises.mkdir(dir, { recursive: true });
                    await fsPromises.writeFile(filePath, toolInput.content || '', 'utf-8');
                    return { type: 'tool_result', tool_use_id: toolId, content: `File written: ${path.relative(workingDir, filePath)}` };
                }
                catch (e) {
                    return { type: 'tool_result', tool_use_id: toolId, content: `Error writing file: ${e.message}` };
                }
            }
            case 'list_files': {
                try {
                    const dir = path.resolve(workingDir, toolInput.path || '.');
                    if (!dir.startsWith(workingDir)) {
                        return { type: 'tool_result', tool_use_id: toolId, content: 'Error: Path outside workspace' };
                    }
                    const files = await fsPromises.readdir(dir, { withFileTypes: true });
                    const listing = files.map(f => `${f.isDirectory() ? '[DIR]' : '[FILE]'} ${f.name}`).join('\n');
                    return { type: 'tool_result', tool_use_id: toolId, content: listing || '(empty directory)' };
                }
                catch (e) {
                    return { type: 'tool_result', tool_use_id: toolId, content: `Error listing files: ${e.message}` };
                }
            }
            case 'execute_command':
            case 'bash': {
                const cmd = toolInput.command || toolInput.cmd || '';
                if (!cmd)
                    return { type: 'tool_result', tool_use_id: toolId, content: 'Error: No command provided' };
                const cwd = toolInput.working_dir ? path.resolve(workingDir, toolInput.working_dir) : workingDir;
                if (!cwd.startsWith(workingDir)) {
                    return { type: 'tool_result', tool_use_id: toolId, content: 'Error: Working directory outside workspace' };
                }
                return new Promise((resolve) => {
                    exec(cmd, { cwd, encoding: 'utf-8', timeout: 60000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                        if (error) {
                            resolve({ type: 'tool_result', tool_use_id: toolId, content: `Command error (code ${error.status}): ${stderr || error.message}` });
                        }
                        else {
                            resolve({ type: 'tool_result', tool_use_id: toolId, content: stdout || '(command executed successfully)' });
                        }
                    });
                });
            }
            default:
                return {
                    type: 'tool_result',
                    tool_use_id: toolId,
                    content: `Tool "${toolName}" is not available. Available: Agent, read_file, write_to_file, list_files, execute_command.`
                };
        }
    }
    /**
     * 格式化子 Agent 的结果
     *
     * @param {string} nodeId - 节点 ID
     * @param {string} nodeLabel - 节点标签
     * @param {string} result - 原始结果
     * @returns {string} 格式化后的结果
     */
    _formatSubagentResult(nodeId, nodeLabel, result) {
        // 如果结果为空，返回提示信息
        if (!result || result.trim() === '') {
            return `[${nodeLabel}] 任务完成，但没有返回结果。`;
        }
        // 截断过长的结果
        const maxLength = 16000;
        const truncated = result.length > maxLength
            ? result.substring(0, maxLength) + '\n\n[结果已截断，完整内容请查看工作区文件]'
            : result;
        return truncated;
    }
    /**
     * Spawn a CLI sub-agent via ClaudeService — full toolset, isolated process, independent context
     */
    async _spawnCliAgent(callId, nodeId, nodeInfo, task, model, systemPrompt, workingDir, meta, permissions) {
        const claudeService = global.__claudeService;
        if (claudeService) {
            const parentTaskId = callId.replace(/_[^_]+_[^_]+$/, '');
            // Write skill guide to working directory for sub-agent to read
            const resultFile = `.subagent_${nodeId}_result.json`;
            const skillFile = `.subagent_${nodeId}_skill.md`;
            try {
                const fs = require('fs');
                fs.writeFileSync(path.join(workingDir, skillFile), systemPrompt, 'utf-8');
            }
            catch (_) { }
            // Build constrained prompt: hard rules + result file mechanism
            // 使用派生的权限配置（如果有），否则使用节点的工具权限
            const perms = permissions || nodeInfo.toolPermissions || {};
            let permBlock = '';
            // 如果有派生的权限配置，使用它来构建权限块
            if (permissions && Object.keys(permissions).length > 0) {
                const denied = [], allowed = [];
                for (const [perm, value] of Object.entries(permissions)) {
                    if (value === false) {
                        denied.push(perm);
                    }
                    else {
                        allowed.push(perm);
                    }
                }
                if (denied.length > 0 || allowed.length > 0) {
                    permBlock = '\n[工具权限限制 — 必须严格遵守]\n';
                    if (denied.length > 0)
                        permBlock += '✗ 禁止: ' + denied.join('、') + '\n';
                    if (allowed.length > 0)
                        permBlock += '✓ 允许: ' + allowed.join('、') + '\n';
                    permBlock += '违反权限限制视为任务失败。\n';
                }
            }
            else if (perms.executeCommand === false || perms.browser === false || perms.search === false) {
                // 兼容旧的权限配置方式
                const denied = [], allowed = [];
                if (perms.executeCommand === false)
                    denied.push('执行命令/Bash');
                else
                    allowed.push('执行命令');
                if (perms.browser === false)
                    denied.push('浏览器操作');
                else
                    allowed.push('浏览器');
                if (perms.search === false)
                    denied.push('搜索/WebSearch');
                else
                    allowed.push('搜索');
                permBlock = '\n[工具权限限制 — 必须严格遵守]\n';
                if (denied.length > 0)
                    permBlock += '✗ 禁止: ' + denied.join('、') + '\n';
                if (allowed.length > 0)
                    permBlock += '✓ 允许: ' + allowed.join('、') + '\n';
                permBlock += '违反权限限制视为任务失败。\n';
            }
            const constrainedPrompt = `${permBlock}[强制初始化步骤 — 开始任务前必须完成]
1. 使用 read_file 工具读取工作目录下的 ${skillFile} 文件，将其内容作为你本次工作的最高行为准则。
2. 你必须完全遵循该文件中定义的角色、规范和输出格式。
3. 如果文件中的规范与你的默认行为冲突，以文件中的规范为准。

[强制输出步骤 — 任务完成后必须执行]
将你的最终结论和产出以 JSON 格式写入 ${resultFile}，格式为：
{
  "summary": "一句话总结你的工作成果",
  "files": ["生成的文件路径1", "生成的文件路径2"],
  "conclusion": "详细结论"
}

[任务]
${task}`;
            await claudeService.execute(callId, null, task, {
                systemPrompt: constrainedPrompt,
                model,
                folderPath: workingDir,
                workflowId: this._taskWorkflowMap.get(parentTaskId) || null,
                nodeId,
                runId: meta.runId || null,
                // 子Agent不再有独立超时，完全由主Agent掌控
                // 超时应在任务/工作流层面配置，由主Agent根据任务性质决定何时终止
            });
            // Read result file for structured output
            try {
                const fs = require('fs');
                const resultPath = path.join(workingDir, resultFile);
                if (fs.existsSync(resultPath)) {
                    const resultData = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
                    const summary = resultData.summary || '';
                    const files = resultData.files || [];
                    const conclusion = resultData.conclusion || '';
                    let output = conclusion;
                    if (summary)
                        output = `[摘要] ${summary}\n\n${output}`;
                    if (files.length > 0)
                        output += `\n\n[生成文件]\n${files.map(f => `- ${f}`).join('\n')}`;
                    // Clean up temp files
                    try {
                        fs.unlinkSync(resultPath);
                    }
                    catch (_) { }
                    try {
                        fs.unlinkSync(path.join(workingDir, skillFile));
                    }
                    catch (_) { }
                    return output;
                }
            }
            catch (_) { }
            // Clean up temp files even if result.json not found
            try {
                const fs = require('fs');
                fs.unlinkSync(path.join(workingDir, skillFile));
            }
            catch (_) { }
            return ''; // Fallback — output was streamed via WebSocket
        }
        // CLI not available → fallback to SDK sub-agent
        logger.warn(`CLI not available for sub-agent ${nodeInfo.label}, using SDK fallback`);
        const client = await this._withEnvLock(async () => new Anthropic(ApiKeyService.getClientConfig()));
        return this._runSubAgent(client, callId, nodeInfo.label, task, model, workingDir, 1);
    }
    /**
     * 通过SDK模式启动子Agent（支持真正的并行执行和生命周期管理）
     * @param {string} callId - 调用ID
     * @param {string} nodeId - 节点ID
     * @param {Object} nodeInfo - 节点信息
     * @param {string} task - 任务描述
     * @param {string} model - 模型别名
     * @param {string} systemPrompt - 系统提示
     * @param {string} workingDir - 工作目录
     * @param {Object} meta - 元数据
     * @param {Object} permissions - 权限配置
     * @returns {Promise<string>} 执行结果
     */
    async _spawnSdkAgent(callId, nodeId, nodeInfo, task, model, systemPrompt, workingDir, meta, permissions, useWorktree = true) {
        const resolvedModel = ApiKeyService.resolveModel(model);
        // 获取上游节点的输出作为上下文
        let upstreamContext = '';
        try {
            if (nodeInfo.upstreamIds && nodeInfo.upstreamIds.length > 0) {
                const upstreamOutputs = [];
                for (const upstreamId of nodeInfo.upstreamIds) {
                    const checkpointFile = path.join(workingDir, '.checkpoint', `${upstreamId}.output.md`);
                    if (fs.existsSync(checkpointFile)) {
                        const output = fs.readFileSync(checkpointFile, 'utf-8');
                        upstreamOutputs.push(`[${upstreamId}]: ${output.substring(0, 1000)}`);
                    }
                }
                if (upstreamOutputs.length > 0) {
                    upstreamContext = upstreamOutputs.join('\n\n');
                }
            }
        }
        catch (err) {
            logger.warn('获取上游上下文失败:', err);
        }
        // 创建独立的 worktree 隔离目录
        let agentWorkDir = workingDir;
        let worktreePath = null;
        if (useWorktree && workingDir) {
            try {
                worktreePath = await this._createWorktree(nodeId, workingDir);
                agentWorkDir = worktreePath;
                logger.info(`子Agent ${nodeInfo.label} 使用独立 worktree: ${worktreePath}`);
            }
            catch (err) {
                logger.warn(`创建 worktree 失败，回退到共享目录: ${err.message}`);
                // 回退：创建子目录隔离
                agentWorkDir = path.join(workingDir, '.agents', nodeId);
                if (!fs.existsSync(agentWorkDir)) {
                    fs.mkdirSync(agentWorkDir, { recursive: true });
                }
            }
        }
        // 构建子Agent的系统提示
        const subSystemPrompt = `${systemPrompt}

╔══════════════════════════════════════════╗
║           子 Agent 执行规则             ║
╚══════════════════════════════════════════╝

[身份信息]
- 名称: ${nodeInfo.label || '执行者'}
- 类型: ${nodeInfo.agentType || 'general'}
- 工作目录: ${agentWorkDir}
- 当前日期: ${new Date().toISOString().slice(0, 10)}

[核心规则]
1. 全自动执行模式，不要提问或请求确认
2. 所有输出必须保存到工作目录的文件中（使用 write_to_file 工具）
3. 保持输出简洁，专注于完成分配的任务
4. 遇到错误时记录到文件并继续执行
5. 不要访问工作目录外的文件

[输出格式要求]
请严格按以下格式输出结果：

## 任务完成情况
- 完成了什么工作
- 遇到的问题（如有）
- 采取的解决措施（如有）

## 生成的文件
- \`filename1.ext\`: 文件描述
- \`filename2.ext\`: 文件描述
- \`directory/\`: 目录描述

## 关键结论
用1-2句话总结任务结果，这个结论会被传递给下游节点。

[错误处理]
如果遇到无法解决的问题：
1. 记录错误信息到 error.log
2. 尝试使用备选方案
3. 如果完全失败，在结论中说明原因
4. 不要因为错误而停止，尽量完成能完成的部分

[上下文信息]
${upstreamContext ? `上游节点输出:\n${upstreamContext}` : '无上游依赖'}

[可用工具]
- Read: 读取文件
- Write: 写入文件
- Edit: 编辑文件
- Bash: 执行命令
- Glob: 查找文件
- Grep: 搜索内容

[质量要求]
- 代码必须有注释
- 文件必须有清晰的结构
- 输出必须易于理解
- 结论必须准确简洁`;
        // 广播子Agent启动事件
        logger.info(`SDK子Agent ${nodeInfo.label} 启动`, { callId, nodeId, model: resolvedModel, workDir: agentWorkDir });
        this._broadcastChunk(callId, null, `[SDK子Agent ${nodeInfo.label} 启动] `, false);
        // 使用 claude-agent-sdk 的 query 函数
        // 子Agent 10分钟超时保护，防止无限挂起
        const SUBAGENT_TIMEOUT = 10 * 60 * 1000;
        const abortController = new AbortController();
        let fullText = '';
        let resultData = null;
        // 读取Claude CLI配置中的环境变量
        let claudeEnv = {};
        try {
            const settingsPath = path.join(require('os').homedir(), '.claude', 'settings.json');
            if (fs.existsSync(settingsPath)) {
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
                if (settings.env) {
                    claudeEnv = settings.env;
                }
            }
        }
        catch (e) {
            logger.warn('Failed to read Claude CLI settings:', e);
        }
        // 保存 abortController 供主Agent主动终止
        this.activeStreams.set(callId, { abortController, startedAt: new Date() });
        try {
            const executionPromise = (async () => {
                // 启动子Agent（异步迭代器）
                for await (const message of query({
                    prompt: task,
                    options: {
                        cwd: agentWorkDir,
                        model: resolvedModel,
                        systemPrompt: subSystemPrompt,
                        permissionMode: 'bypassPermissions',
                        maxTurns: 20,
                        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
                        abortController: abortController,
                        env: { ...process.env, ...claudeEnv },
                    }
                })) {
                    // 检查是否被主Agent终止
                    if (abortController.signal.aborted) {
                        const reason = abortController.signal.reason || '主Agent终止';
                        logger.info(`子Agent ${nodeInfo.label} 被主Agent终止: ${reason}`);
                        throw new Error(`AGENT_ABORTED: ${reason}`);
                    }
                    // 实时记录到日志
                    logger.info(`SDK子Agent ${nodeInfo.label} 消息`, { type: message.type });
                    // 广播进度（注意：消息在message.message.content中）
                    if (message.type === 'assistant') {
                        const content = message.message?.content || [];
                        for (const block of content) {
                            if (block.type === 'text' && block.text) {
                                fullText += block.text;
                                this._broadcastChunk(callId, null, block.text, false);
                            }
                        }
                    }
                    else if (message.type === 'result') {
                        // 最终结果
                        if (message.subtype === 'success') {
                            resultData = message.result;
                            fullText = resultData || fullText;
                        }
                        else if (message.subtype === 'error') {
                            throw new Error(message.error || '子Agent执行失败');
                        }
                        else if (message.subtype === 'error_max_turns') {
                            logger.warn(`[SdkService] 子Agent ${callId} 达到最大轮次限制`);
                            resultData = message.result || fullText || '(达到轮次限制，部分完成)';
                            fullText = resultData;
                        }
                    }
                }
                // 获取 worktree 变更摘要
                let worktreeSummary = '';
                if (worktreePath) {
                    worktreeSummary = await this._getWorktreeSummary(worktreePath);
                    fullText += `\n\n[Worktree 变更摘要]\n${worktreeSummary}`;
                }
                return fullText;
            })();
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Sub-agent timed out')), SUBAGENT_TIMEOUT));
            fullText = await Promise.race([executionPromise, timeoutPromise]);
            // 广播子Agent完成事件
            this._broadcastChunk(callId, null, `\n[SDK子Agent ${nodeInfo.label} 完成]\n`, false);
            logger.info(`SDK子Agent ${nodeInfo.label} 完成`, { callId, nodeId, outputLength: fullText.length });
            // 清理 activeStreams
            this.activeStreams.delete(callId);
            return fullText;
        }
        catch (err) {
            // 清理 activeStreams
            this.activeStreams.delete(callId);
            // 超时检测
            if (err.message === 'Sub-agent timed out') {
                logger.warn(`SDK子Agent ${nodeInfo.label} 超时 (${SUBAGENT_TIMEOUT / 1000}秒)，已强制终止`);
                this._broadcastChunk(callId, null, `\n[超时: ${nodeInfo.label} 超过 ${SUBAGENT_TIMEOUT / 60000} 分钟限制]\n`, false);
                abortController.abort('TIMEOUT');
                throw new Error(`子Agent "${nodeInfo.label}" 执行超时（${SUBAGENT_TIMEOUT / 60000}分钟）`);
            }
            // 429错误：等待后重试
            if (err.status === 429 || err.message?.includes('429') || err.message?.includes('Too many requests')) {
                const retryDelay = 5000;
                logger.warn(`SDK子Agent ${nodeInfo.label} 遇到429限流，${retryDelay / 1000}秒后重试`);
                this._broadcastChunk(callId, null, `\n[等待API恢复 ${retryDelay / 1000}秒...]\n`, false);
                await new Promise(r => setTimeout(r, retryDelay));
                // 重试一次（不创建新的 worktree）
                return this._spawnSdkAgent(callId, nodeId, nodeInfo, task, model, systemPrompt, workingDir, meta, permissions, false);
            }
            logger.error(`SDK子Agent ${nodeInfo.label} 执行错误`, { error: err.message });
            throw err;
        }
        finally {
            // 清理 worktree（可选：保留用于调试）
            // if (worktreePath) {
            //   await this._forcePruneWorktree(nodeId, workingDir);
            // }
        }
    }
    /**
     * Run a sub-agent via SDK (fallback when CLI not available)
     */
    async _runSubAgent(client, parentTaskId, description, prompt, modelAlias, workingDir, depth = 1) {
        const model = ApiKeyService.resolveModel(modelAlias);
        const fullTools = this._buildTools(workingDir);
        const subSystemPrompt = `你是一个子 Agent (层级: ${depth})，工作目录: ${workingDir}
当前日期: ${new Date().toISOString().slice(0, 10)}

[关键规则]
1. 你是全自动执行模式，不要提问或请求确认。
2. 必须将输出保存到工作目录的文件中（使用 write_to_file 工具）。
3. 输出末尾必须包含 [文件清单] 和 [关键结论]。
4. 保持输出简洁，专注于完成分配的任务。
5. 如果需要进一步分工，可以使用 Agent 工具委派子任务（最多 ${this._maxAgentDepth - depth} 层嵌套）。`;
        const messages = [{ role: 'user', content: `任务: ${description}\n\n详细说明: ${prompt}` }];
        let fullText = '';
        this._broadcastChunk(parentTaskId, null, `[子Agent L${depth} ${description}] `, false);
        while (true) {
            // ── 流式模式 ──
            // 使用 Anthropic SDK 的流式 API，实时推送每个 token
            const stream = await client.messages.create({
                model,
                system: [{ type: 'text', text: subSystemPrompt }],
                messages,
                tools: fullTools,
                max_tokens: 16000,
                stream: true, // 启用流式模式
            });
            const content = [];
            let currentText = '';
            let currentToolInputJson = '';
            // 处理流式响应
            for await (const event of stream) {
                if (event.type === 'content_block_delta') {
                    const delta = event.delta;
                    if (delta.type === 'text_delta') {
                        currentText += delta.text;
                        // 实时推送文本块
                        this._broadcastChunk(parentTaskId, null, delta.text, false);
                    }
                    else if (delta.type === 'input_json_delta') {
                        currentToolInputJson += delta.partial_json;
                    }
                }
                else if (event.type === 'content_block_start') {
                    const block = event.content_block;
                    if (block.type === 'tool_use') {
                        currentToolInputJson = '';
                        content.push({
                            type: 'tool_use',
                            id: block.id,
                            name: block.name,
                            input: {},
                        });
                    }
                    else if (block.type === 'text') {
                        content.push({
                            type: 'text',
                            text: '',
                        });
                    }
                }
                else if (event.type === 'content_block_stop') {
                    const lastBlock = content[content.length - 1];
                    if (lastBlock) {
                        if (lastBlock.type === 'text') {
                            lastBlock.text = currentText;
                            fullText += currentText;
                            currentText = '';
                        }
                        else if (lastBlock.type === 'tool_use') {
                            try {
                                if (currentToolInputJson) {
                                    lastBlock.input = JSON.parse(currentToolInputJson);
                                }
                            }
                            catch (e) {
                                logger.warn('Failed to parse tool input JSON', { error: e.message });
                            }
                            currentToolInputJson = '';
                        }
                    }
                }
                else if (event.type === 'message_delta') {
                    // 检查停止原因
                    const stopReason = event.delta.stop_reason;
                    if (stopReason === 'end_turn') {
                        break;
                    }
                }
            }
            // 处理工具调用
            const toolBlocks = content.filter(block => block.type === 'tool_use');
            if (toolBlocks.length > 0) {
                const toolResults = [];
                for (const block of toolBlocks) {
                    const result = await this._handleToolCall(block, client, parentTaskId, workingDir, fullTools, [], depth);
                    toolResults.push(result);
                }
                messages.push({ role: 'assistant', content });
                messages.push({ role: 'user', content: toolResults });
                continue;
            }
            // max_tokens — continue
            messages.push({ role: 'assistant', content });
            messages.push({ role: 'user', content: [{ type: 'text', text: 'Please continue.' }] });
        }
        return fullText;
    }
    /**
     * Build tool definitions including the Agent tool for multi-agent delegation
     */
    _buildTools(workingDir) {
        const tools = [];
        // Generate named Agent tools from workflow node registry
        for (const [nodeId, nodeInfo] of Object.entries(this._nodeRegistry)) {
            const toolName = `Agent_${nodeId}`;
            const skills = nodeInfo.skills || [];
            const mcp = nodeInfo.mcp || [];
            const agentType = nodeInfo.agentType || 'general-purpose';
            const typeDesc = agentType === 'Explore' ? '只读探索' : '完整权限';
            const descParts = [
                `执行[${nodeInfo.label}]任务。`,
                `角色: ${nodeInfo.rolePrompt || '专业执行者'}`,
                `使用模型: ${nodeInfo.model || 'sonnet'}`,
                `类型: ${agentType} (${typeDesc})`,
            ];
            if (skills.length > 0)
                descParts.push(`技能: ${skills.join(', ')}`);
            if (mcp.length > 0)
                descParts.push(`外部工具: ${mcp.join(', ')}`);
            tools.push({
                name: toolName,
                description: descParts.join(' '),
                input_schema: {
                    type: 'object',
                    properties: {
                        task: { type: 'string', description: `具体要执行的${nodeInfo.label}相关任务` },
                        prompt: { type: 'string', description: `具体要执行的${nodeInfo.label}相关任务（与 task 相同）` },
                        run_in_background: { type: 'boolean', description: '是否后台异步执行' }
                    },
                    required: ['task']
                }
            });
        }
        // Generic Agent tool as fallback
        tools.push({
            name: 'Agent',
            description: `通用子 Agent，用于工作流节点之外的任务委派。优先使用具名的 Agent_xxx 工具。\n\n可用类型:\n- Explore: 只读探索\n- general-purpose: 完整权限`,
            input_schema: {
                type: 'object',
                properties: {
                    description: { type: 'string', description: '简短描述子 Agent 要做什么' },
                    prompt: { type: 'string', description: '子 Agent 的完整任务提示词' },
                    model: { type: 'string', enum: ['opus', 'sonnet', 'haiku'], description: '使用的模型' },
                    agent_type: { type: 'string', enum: ['Explore', 'general-purpose'], description: '子 Agent 类型（Explore: 只读探索，general-purpose: 完整权限）' },
                    run_in_background: { type: 'boolean', description: '是否后台异步执行' }
                },
                required: ['description', 'prompt']
            }
        });
        // Standard tools
        tools.push({
            name: 'request_approval',
            description: '请求人工审核。当你需要人类确认某个操作、审核输出内容、或批准下一步计划时调用此工具。调用后会暂停执行直到收到审核结果。',
            input_schema: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: '审核请求的标题（如 "请确认删除操作"）' },
                    description: { type: 'string', description: '详细描述需要审核的内容、上下文和关键决策点' },
                    content: { type: 'string', description: '待审核的具体内容（代码、报告、方案等）' }
                },
                required: ['title', 'description']
            }
        }, {
            name: 'read_file',
            description: 'Read a file from the workspace directory',
            input_schema: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Relative or absolute path to the file' },
                    offset: { type: 'integer', description: 'Line offset for large files' },
                    limit: { type: 'integer', description: 'Max lines to read' }
                },
                required: ['file_path']
            }
        }, {
            name: 'write_to_file',
            description: 'Write content to a file in the workspace directory',
            input_schema: {
                type: 'object',
                properties: {
                    file_path: { type: 'string', description: 'Path to the file (relative to workspace)' },
                    content: { type: 'string', description: 'Content to write to the file' }
                },
                required: ['file_path', 'content']
            }
        }, {
            name: 'list_files',
            description: 'List files and directories in the workspace',
            input_schema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path relative to workspace (default: workspace root)' }
                },
                required: []
            }
        }, {
            name: 'execute_command',
            description: 'Execute a shell command within the workspace directory',
            input_schema: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The shell command to execute' },
                    working_dir: { type: 'string', description: 'Working directory relative to workspace (default: workspace root)' }
                },
                required: ['command']
            }
        });
        return tools;
    }
    /**
     * Buffered broadcast: batches WebSocket messages with a 50ms window
     * to reduce per-message overhead without adding latency.
     */
    _bufferedBroadcast(taskId, chunk, done) {
        if (!this._messageBuffers.has(taskId)) {
            this._messageBuffers.set(taskId, { buffer: [], timer: null });
        }
        const buf = this._messageBuffers.get(taskId);
        buf.buffer.push({ chunk, done });
        if (!buf.timer) {
            buf.timer = setTimeout(() => {
                const batch = buf.buffer.splice(0);
                buf.timer = null;
                // Send all buffered chunks at once
                for (const item of batch) {
                    this._broadcastChunk(taskId, null, item.chunk, item.done);
                }
            }, 50);
        }
    }
    /**
     * Broadcast a streaming chunk via WebSocket
     */
    _broadcastChunk(taskId, agentId, chunk, isComplete) {
        if (this.broadcastService) {
            const meta = this._taskMetaMap?.get(taskId) || {};
            this.broadcastService.broadcast('claude.stream', {
                taskId,
                agentId: agentId || meta.agentId,
                workflowId: this._taskWorkflowMap.get(taskId) || null,
                nodeId: meta.nodeId || null,
                runId: meta.runId || null,
                chunk,
                isComplete,
            });
        }
    }
    /**
     * Handle an approval decision from the frontend (SDK mode)
     */
    handleApprovalDecision(requestId, decision, comment) {
        const pending = this._pendingApprovals.get(requestId);
        if (!pending)
            return false;
        clearTimeout(pending.timer);
        this._pendingApprovals.delete(requestId);
        pending.resolve({ approved: decision === 'approve', comment: comment || '' });
        logger.info(`SDK approval resolved: ${requestId} -> ${decision}`);
        return true;
    }
    /**
     * Cancel an active execution
     */
    cancel(taskId) {
        const entry = this.activeStreams.get(taskId);
        if (entry) {
            entry.abortController.abort('CANCELLED');
            this.activeStreams.delete(taskId);
            logger.info('SDK execution cancelled', { taskId });
            return true;
        }
        return false;
    }
    pause(taskId) {
        const entry = this.activeStreams.get(taskId);
        if (entry) {
            entry.abortController.abort('PAUSED');
            logger.info('SDK execution paused', { taskId });
            return true;
        }
        return false;
    }
    /**
     * Get active execution count
     */
    getActiveCount() {
        return this.activeStreams.size;
    }
    /**
     * Classify SDK/API errors
     */
    _classifySdkError(err) {
        const s = (err.message || '').toLowerCase();
        if (s.includes('401') || s.includes('unauthorized') || s.includes('invalid') && s.includes('api key')) {
            return { type: 'AUTH_ERROR', message: 'API Key 无效，请在设置页面重新配置', statusCode: 401, retryable: false };
        }
        if (s.includes('402') || s.includes('payment') || s.includes('billing') || s.includes('insufficient')) {
            return { type: 'BILLING_ERROR', message: '账户余额不足，请检查账户状态', statusCode: 402, retryable: false };
        }
        if (s.includes('429') || s.includes('rate') || s.includes('too many')) {
            return { type: 'RATE_LIMITED', message: 'API 请求频率超限，请稍后重试', statusCode: 429, retryable: true };
        }
        if (s.includes('529') || s.includes('overloaded') || s.includes('service unavailable')) {
            return { type: 'SERVICE_OVERLOADED', message: 'API 服务暂时过载，请稍后重试', statusCode: 529, retryable: true };
        }
        if (s.includes('timeout') || s.includes('timed out')) {
            return { type: 'TIMEOUT', message: 'SDK 执行超时（30分钟）', statusCode: 408, retryable: true };
        }
        if (s.includes('context') && (s.includes('length') || s.includes('window') || s.includes('too long'))) {
            return { type: 'CONTEXT_TOO_LONG', message: '输入超出上下文窗口限制', statusCode: 400, retryable: false };
        }
        return { type: 'EXECUTION_ERROR', message: err.message || 'SDK execution failed', statusCode: 500, retryable: false };
    }
}
// 使用 CommonJS 导出以保持与现有路由的兼容性
module.exports = SdkService;
module.exports.SdkService = SdkService;
module.exports.default = SdkService;
//# sourceMappingURL=SdkService.js.map