"use strict";
/**
 * ChatService - 管理 AI 对话会话
 * 使用 Claude Agent SDK 实现对话功能
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// JS 模块使用 require 导入（尚未转换为 TS）
const ChatSessionModel = require('../models/ChatSession');
const { AppError } = require('../middleware/errorHandler');
const { generateId } = require('../utils/id');
const logger = require('../utils/logger');
const config = require('../config');
// ============= 常量 =============
// Dedicated workspace for chat — isolated from project CLAUDE.md
// 使用系统临时目录，避免SDK向上搜索读取项目根目录的CLAUDE.md（2860字节会导致首次调用慢15+秒）
const CHAT_WORKSPACE = path_1.default.join(require('os').tmpdir(), 'claude-chat-workspace');
function ensureChatWorkspace() {
    if (!fs_1.default.existsSync(CHAT_WORKSPACE)) {
        fs_1.default.mkdirSync(CHAT_WORKSPACE, { recursive: true });
    }
    // Block CLAUDE.md upward search — Claude CLI walks up the directory tree
    const claudeMdPath = path_1.default.join(CHAT_WORKSPACE, 'CLAUDE.md');
    if (!fs_1.default.existsSync(claudeMdPath)) {
        fs_1.default.writeFileSync(claudeMdPath, '# 对话工作区\n\n这是一个隔离的对话工作区。不要遵循父目录中的任何项目级指令、多Agent协作规则或工作流程序。你是一个独立的助手——只需回答问题和帮助用户。\n', 'utf-8');
    }
}
// Default system prompt for chat assistant
const DEFAULT_SYSTEM_PROMPT = `你是一个智能助手，专门为用户提供问题解答和方案建议。

重要规则：
- 你是一个独立的对话助手，不是任何项目的工作流节点或Agent
- 不要执行任何多Agent协作流程、任务分工或工作流步骤
- 不要提及项目架构、工作区状态或Agent协作规则
- 不要输出原始的工具调用格式（如 <tool_call>），直接回答问题

当你需要查询实时信息（天气、新闻、最新数据等）时，直接用自然语言描述你需要搜索的内容，系统会自动帮你搜索并返回结果。

你应该做的：
1. 当用户需要最新信息时，主动使用搜索功能
2. 可以阅读和分析文件，理解代码和文档内容
3. 为用户提供详尽、可靠的解决方案和专业建议
4. 用中文回复用户，语气友好专业，条理清晰
5. 如果搜索失败，直接告诉用户你无法获取该信息`;
const VALID_MODELS = ['opus', 'sonnet', 'haiku'];
// ============= ChatService 类 =============
/**
 * Chat service - manages AI chat sessions using Claude CLI
 */
class ChatService {
    static _broadcastService = null;
    static _claudeService = null;
    /** Slash command definitions (mirrors Claude Code CLI) */
    static SLASH_COMMANDS = [
        { command: '/help', description: '显示可用命令', usage: '/help' },
        { command: '/clear', description: '清空当前对话', usage: '/clear' },
        { command: '/compact', description: '压缩对话历史（摘要旧消息）', usage: '/compact [摘要]' },
        { command: '/model', description: '查看或切换模型', usage: '/model [模型名]' },
        { command: '/system', description: '查看或设置系统提示词', usage: '/system [提示词]' },
        { command: '/config', description: '查看或修改会话配置', usage: '/config [key] [value]' },
        { command: '/status', description: '显示会话状态', usage: '/status' },
        { command: '/memory', description: '编辑系统提示词', usage: '/memory [内容]' },
        { command: '/export', description: '导出对话记录', usage: '/export' },
        { command: '/archive', description: '归档当前对话', usage: '/archive' },
        { command: '/delete', description: '删除当前对话', usage: '/delete' },
        { command: '/review', description: '请求 AI 审查代码', usage: '/review [描述]' },
        { command: '/bug', description: '报告问题', usage: '/bug [描述]' },
    ];
    /**
     * Initialize with dependencies
     */
    static init(broadcastService, claudeService) {
        ChatService._broadcastService = broadcastService;
        ChatService._claudeService = claudeService;
    }
    /**
     * Create a new chat session
     */
    static createSession(data = {}) {
        return ChatSessionModel.create(data);
    }
    /**
     * Get all sessions
     */
    static getSessions(filters = {}) {
        return ChatSessionModel.findAll(filters);
    }
    /**
     * Get session by ID
     */
    static getSession(id) {
        const session = ChatSessionModel.findById(id);
        if (!session) {
            throw new AppError('NOT_FOUND', `Chat session '${id}' not found`, 404);
        }
        return session;
    }
    static updateSession(id, data) {
        const session = ChatSessionModel.findById(id);
        if (!session) {
            throw new AppError('NOT_FOUND', `Chat session '${id}' not found`, 404);
        }
        return ChatSessionModel.update(id, data);
    }
    /**
     * Delete a chat session
     */
    static deleteSession(id) {
        if (!ChatSessionModel.exists(id)) {
            throw new AppError('NOT_FOUND', `Chat session '${id}' not found`, 404);
        }
        // 清除SDK会话ID缓存
        ChatService._sdkSessionIds.delete(id);
        return ChatSessionModel.delete(id);
    }
    /**
     * Archive a chat session
     */
    static archiveSession(id) {
        const session = ChatSessionModel.findById(id);
        if (!session) {
            throw new AppError('NOT_FOUND', `Chat session '${id}' not found`, 404);
        }
        return ChatSessionModel.update(id, { status: 'archived' });
    }
    /**
     * Send a message to a chat session and get Claude's response
     */
    static async sendMessage(sessionId, content) {
        const session = ChatSessionModel.findById(sessionId);
        if (!session) {
            throw new AppError('NOT_FOUND', `Chat session '${sessionId}' not found`, 404);
        }
        // 检测斜杠命令
        const slashMatch = content.trim().match(/^\/(\w+)(.*)?$/s);
        if (slashMatch) {
            const command = `/${slashMatch[1]}`;
            const args = slashMatch[2] ? slashMatch[2].trim() : '';
            // 验证是否为已知命令
            const knownCommand = this.SLASH_COMMANDS.find(c => c.command === command);
            if (knownCommand) {
                // 添加用户消息
                const userMessage = ChatSessionModel.addMessage(sessionId, {
                    role: 'user',
                    content
                });
                // 执行斜杠命令
                const result = this.executeSlashCommand(sessionId, command, args);
                // 添加助手消息（命令结果）
                const assistantMessage = ChatSessionModel.addMessage(sessionId, {
                    role: 'assistant',
                    content: JSON.stringify(result, null, 2),
                    metadata: { slashCommand: command, commandResult: result }
                });
                return { userMessage, assistantMessage, slashCommand: result };
            }
        }
        // Add user message
        const userMessage = ChatSessionModel.addMessage(sessionId, {
            role: 'user',
            content
        });
        // 使用SDK模式调用Claude（会自动获取对话历史）
        const response = await this._callClaude(sessionId, content, session.model, session.systemPrompt);
        // Detect actionable content in the response
        const actions = this._detectActions(response);
        if (actions.length > 0 && this._broadcastService) {
            // Add assistant message with pending actions
            const assistantMessage = ChatSessionModel.addMessage(sessionId, {
                role: 'assistant',
                content: response,
                metadata: { pendingActions: actions.map(a => a.id) }
            });
            // Broadcast confirmation request to client
            for (const action of actions) {
                this._broadcastService.broadcast('chat.confirmAction', {
                    sessionId,
                    actionId: action.id,
                    type: action.type,
                    description: action.description,
                    data: action.data
                });
            }
            // 自动生成标题（仅在标题仍为默认值且已有足够消息时触发）
            const refreshedSession = ChatSessionModel.findById(sessionId);
            if (refreshedSession &&
                this._isDefaultTitle(refreshedSession.title) &&
                refreshedSession.messages.length >= 3) {
                this._generateTitle(sessionId, refreshedSession.messages.slice(0, 4))
                    .catch((err) => logger.warn('Auto-generate title failed', { sessionId, error: err.message }));
            }
            return { userMessage, assistantMessage, pendingActions: actions };
        }
        // No actionable content — add assistant message normally
        const assistantMessage = ChatSessionModel.addMessage(sessionId, {
            role: 'assistant',
            content: response,
            metadata: {}
        });
        // 自动生成标题（仅在标题仍为默认值且已有足够消息时触发）
        const refreshedSession = ChatSessionModel.findById(sessionId);
        if (refreshedSession &&
            this._isDefaultTitle(refreshedSession.title) &&
            refreshedSession.messages.length >= 3) {
            this._generateTitle(sessionId, refreshedSession.messages.slice(0, 4))
                .catch((err) => logger.warn('Auto-generate title failed', { sessionId, error: err.message }));
        }
        return { userMessage, assistantMessage };
    }
    /**
     * Detect actionable content in Claude's response
     */
    static _detectActions(response) {
        const { v4: uuidv4 } = require('uuid');
        const actions = [];
        // Detect file write patterns: ```filename: path\ncontent\n```
        const fileWriteRegex = /```(?:file|write|save)?\s*(?:[:|])\s*(.+?)\n([\s\S]*?)```/g;
        let match;
        while ((match = fileWriteRegex.exec(response)) !== null) {
            const filePath = match[1].trim();
            const fileContent = match[2];
            // Only flag if it looks like a real file path (has extension or path separator)
            if (filePath.match(/\.\w+$/) || filePath.includes('/') || filePath.includes('\\')) {
                actions.push({
                    id: uuidv4(),
                    type: 'write',
                    description: `写入文件: ${filePath}`,
                    data: { path: filePath, content: fileContent }
                });
            }
        }
        // Detect command execution patterns: `run: command` or shell code blocks
        const cmdRegex = /```(?:bash|sh|shell|cmd|powershell)\n([\s\S]*?)```/g;
        while ((match = cmdRegex.exec(response)) !== null) {
            const commands = match[1].trim().split('\n').filter((l) => l.trim() && !l.startsWith('#'));
            if (commands.length > 0) {
                actions.push({
                    id: uuidv4(),
                    type: 'run',
                    description: `执行命令: ${commands[0]}${commands.length > 1 ? ` (及 ${commands.length - 1} 条其他命令)` : ''}`,
                    data: { command: commands.join(' && ') }
                });
            }
        }
        return actions;
    }
    /**
     * Add a system message to a session
     */
    static addSystemMessage(sessionId, content) {
        return ChatSessionModel.addMessage(sessionId, {
            role: 'system',
            content
        });
    }
    /**
     * Execute a confirmed action (file write, command run)
     */
    static async executeConfirmedAction(sessionId, action) {
        const session = ChatSessionModel.findById(sessionId);
        if (!session) {
            throw new AppError('NOT_FOUND', `Chat session '${sessionId}' not found`, 404);
        }
        const FileService = require('./FileService');
        const workspaceRoot = FileService.getWorkspaceRoot();
        if (!workspaceRoot)
            throw new AppError('VALIDATION_ERROR', '没有活跃的工作区', 400);
        if (action.type === 'write') {
            if (!action.path || !action.content) {
                throw new AppError('VALIDATION_ERROR', '写入文件需要路径和内容', 400);
            }
            // Prevent path traversal
            if (action.path.includes('..')) {
                throw new AppError('VALIDATION_ERROR', '不允许路径遍历', 400);
            }
            const filePath = path_1.default.join(workspaceRoot, action.path);
            const dir = path_1.default.dirname(filePath);
            fs_1.default.mkdirSync(dir, { recursive: true });
            fs_1.default.writeFileSync(filePath, action.content, 'utf-8');
            ChatSessionModel.addMessage(sessionId, {
                role: 'system',
                content: `[Action] File written: ${action.path}`
            });
            return { success: true, type: 'write', path: action.path };
        }
        if (action.type === 'run') {
            if (!action.command) {
                throw new AppError('VALIDATION_ERROR', '执行命令需要 command 字段', 400);
            }
            // 安全检查：只允许只读命令
            const SAFE_COMMANDS = ['ls', 'dir', 'cat', 'type', 'head', 'tail', 'wc', 'grep', 'find', 'echo', 'pwd', 'whoami', 'date', 'env'];
            const cmdBase = action.command.trim().split(/\s+/)[0].toLowerCase();
            if (!SAFE_COMMANDS.includes(cmdBase)) {
                throw new AppError('VALIDATION_ERROR', `不允许执行命令: ${cmdBase}。只允许只读命令: ${SAFE_COMMANDS.join(', ')}`, 400);
            }
            return new Promise((resolve, reject) => {
                // 解析命令和参数，避免 shell 注入
                const parts = action.command.trim().split(/\s+/);
                const cmd = parts[0];
                const args = parts.slice(1);
                const proc = (0, child_process_1.spawn)(cmd, args, {
                    cwd: workspaceRoot,
                    shell: false, // 禁用 shell，防止命令注入
                    windowsHide: true,
                    ...(process.platform === 'win32' ? { creationFlags: 0x08000000 } : {}),
                    timeout: 30000
                });
                let stdout = '';
                let stderr = '';
                proc.stdout?.on('data', (d) => stdout += d.toString());
                proc.stderr?.on('data', (d) => stderr += d.toString());
                proc.on('close', (code) => {
                    ChatSessionModel.addMessage(sessionId, {
                        role: 'system',
                        content: `[Action] Command executed: ${action.command}\nExit code: ${code}\n${stdout}${stderr ? '\nStderr: ' + stderr : ''}`
                    });
                    resolve({ success: true, type: 'run', command: action.command, exitCode: code, stdout, stderr });
                });
                proc.on('error', (err) => {
                    reject(new AppError('EXECUTION_ERROR', `Command failed: ${err.message}`, 500));
                });
            });
        }
        throw new AppError('VALIDATION_ERROR', `Unknown action type: ${action.type}`, 400);
    }
    /**
     * Execute a slash command
     */
    static executeSlashCommand(sessionId, command, args) {
        const session = ChatSessionModel.findById(sessionId);
        if (!session) {
            throw new AppError('NOT_FOUND', `Chat session '${sessionId}' not found`, 404);
        }
        switch (command) {
            case '/help':
                return { type: 'help', commands: this.SLASH_COMMANDS };
            case '/clear':
                ChatSessionModel.update(sessionId, { messages: [] });
                ChatSessionModel.addMessage(sessionId, { role: 'system', content: '[System] Chat history cleared' });
                return { type: 'clear', message: 'Chat history cleared' };
            case '/compact':
                ChatSessionModel.addMessage(sessionId, { role: 'system', content: `[System] Conversation compacted: ${args || 'Previous messages summarized'}` });
                return { type: 'compact', message: 'Conversation compacted' };
            case '/model': {
                const currentDisplay = VALID_MODELS.includes(session.model) ? session.model : 'haiku';
                if (!args)
                    return { type: 'model', current: currentDisplay };
                const requested = args.trim().toLowerCase();
                const newModel = VALID_MODELS.includes(requested) ? requested : 'haiku';
                ChatSessionModel.update(sessionId, { model: newModel });
                return { type: 'model', message: `模型已切换为: ${newModel}`, model: newModel };
            }
            case '/system':
                if (!args)
                    return { type: 'system', current: session.systemPrompt };
                ChatSessionModel.update(sessionId, { systemPrompt: args.trim() });
                return { type: 'system', message: 'System prompt updated', systemPrompt: args.trim() };
            case '/config': {
                if (!args)
                    return { type: 'config', current: { model: VALID_MODELS.includes(session.model) ? session.model : 'haiku', systemPrompt: session.systemPrompt, status: session.status } };
                const cfgParts = args.split(/\s+/);
                const cfgKey = cfgParts[0];
                const cfgVal = cfgParts.slice(1).join(' ');
                if (!cfgVal)
                    return { type: 'config', key: cfgKey, value: session[cfgKey] };
                ChatSessionModel.update(sessionId, { [cfgKey]: cfgVal });
                return { type: 'config', message: `Config updated: ${cfgKey} = ${cfgVal}` };
            }
            case '/status': {
                return {
                    type: 'status',
                    id: sessionId,
                    title: session.title,
                    model: VALID_MODELS.includes(session.model) ? session.model : 'haiku',
                    status: session.status,
                    messageCount: session.messages.length,
                    createdAt: session.createdAt
                };
            }
            case '/memory':
                if (!args)
                    return { type: 'memory', current: session.systemPrompt };
                ChatSessionModel.update(sessionId, { systemPrompt: args.trim() });
                return { type: 'memory', message: 'Memory updated', systemPrompt: args.trim() };
            case '/export': {
                const exportText = session.messages.map((m) => `[${m.role}] ${new Date(m.timestamp).toISOString()}\n${m.content}\n`).join('\n---\n');
                return { type: 'export', content: exportText };
            }
            case '/delete':
                this.deleteSession(sessionId);
                return { type: 'delete', message: 'Session deleted' };
            case '/review':
            case '/bug':
                return { type: 'passthrough', content: args };
            default:
                throw new AppError('VALIDATION_ERROR', `Unknown command: ${command}`, 400);
        }
    }
    /**
     * Build a prompt from conversation history
     */
    static _buildPrompt(messages, currentInput) {
        if (messages.length <= 1)
            return currentInput;
        const context = messages
            .filter(m => m.role !== 'system')
            .slice(0, -1) // Exclude current input (already added as last message)
            .map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
            .join('\n\n');
        return `${context}\n\nHuman: ${currentInput}`;
    }
    // SDK会话ID缓存，用于复用会话避免重复启动子进程
    static _sdkSessionIds = new Map();
    /**
     * 使用Claude Agent SDK的query函数调用Claude
     * 支持会话复用（resume），避免每次调用都启动新子进程
     */
    static async _callClaude(sessionId, prompt, model, systemPrompt) {
        const ApiKeyService = require('./ApiKeyService');
        const { query } = require('@anthropic-ai/claude-agent-sdk');
        const finalSystemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;
        // 规范化模型别名
        const normalizedModel = VALID_MODELS.includes(model) ? model : 'haiku';
        // 使用 resolveModel 获取实际模型ID
        const resolvedModel = ApiKeyService.resolveModel(normalizedModel);
        // Inject model identity
        const modelLabel = normalizedModel === 'opus' ? 'Opus（最强推理模型）'
            : normalizedModel === 'haiku' ? 'Haiku（快速轻量模型）'
                : 'Sonnet（平衡模型）';
        const identityPrompt = `\n\n[模型身份] 你当前以 ${modelLabel} 模型身份运行。当用户询问你是什么模型时，请回答你是 ${modelLabel}，不要提及底层实现模型或自称为其他模型名称。`;
        const effectiveSystemPrompt = finalSystemPrompt + identityPrompt;
        // 读取Claude CLI配置中的环境变量
        const fs = require('fs');
        const path = require('path');
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
        // 检查是否有可复用的SDK会话ID
        const existingSdkSessionId = ChatService._sdkSessionIds.get(sessionId);
        let output = '';
        let newSdkSessionId;
        const abortController = new AbortController();
        // 5分钟超时，防止工具调用无限挂起
        const chatTimeout = setTimeout(() => abortController.abort(), 5 * 60 * 1000);
        try {
            // 使用Claude Agent SDK的query函数
            const callStart = Date.now();
            // 使用隔离的聊天工作区，避免SDK扫描项目目录（35K文件会导致首次调用极慢）
            ensureChatWorkspace();
            const queryOptions = {
                cwd: CHAT_WORKSPACE,
                model: resolvedModel,
                systemPrompt: effectiveSystemPrompt,
                permissionMode: 'bypassPermissions',
                maxTurns: 10,
                abortController: abortController,
                env: { ...process.env, ...claudeEnv },
                // 不指定 allowedTools，让 SDK 自动发现可用工具
                // 添加 PreToolUse hook 来拦截工具调用
                hooks: {
                    PreToolUse: [{
                            matcher: '.*',
                            callback: async (input) => {
                                const toolName = input.tool_name;
                                const toolInput = input.tool_input || {};
                                try {
                                    const { exec } = require('child_process');
                                    const { promisify } = require('util');
                                    const execAsync = promisify(exec);
                                    // 拦截 WebSearch 调用 - 直接用 curl 获取网页内容
                                    if (toolName === 'WebSearch') {
                                        const query = toolInput.query || '';
                                        logger.info(`[ChatStream] 拦截 WebSearch: ${query}`);
                                        // 天气查询用 wttr.in
                                        if (query.includes('天气') || query.includes('weather')) {
                                            const city = query.replace(/天气|weather|今天|的|查|查询|帮我/g, '').trim() || '深圳';
                                            const result = await execAsync(`curl -s -L --max-time 8 "https://wttr.in/${encodeURIComponent(city)}?format=%l:+%c+%t+%h+%w&lang=zh"`, { encoding: 'utf-8', timeout: 12000 });
                                            if (result.stdout?.trim()) {
                                                return { hookSpecificOutput: { permissionDecision: 'allow', toolResult: result.stdout.trim() } };
                                            }
                                        }
                                        // 其他搜索用 DuckDuckGo HTML 页面
                                        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
                                        const result = await execAsync(`curl -s -L --max-time 10 -A "Mozilla/5.0" "${searchUrl}"`, { encoding: 'utf-8', timeout: 15000 });
                                        // 提取搜索结果文本
                                        let text = result.stdout || '';
                                        // 移除 HTML 标签，保留文本
                                        text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                                            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                                            .replace(/<[^>]+>/g, ' ')
                                            .replace(/\s+/g, ' ')
                                            .trim()
                                            .substring(0, 2000);
                                        return {
                                            hookSpecificOutput: {
                                                permissionDecision: 'allow',
                                                toolResult: text || '搜索未返回结果，请尝试更具体的关键词'
                                            }
                                        };
                                    }
                                    // 拦截 Bash 中的 curl 天气查询
                                    if (toolName === 'Bash') {
                                        const cmd = toolInput.command || '';
                                        if (cmd.includes('wttr.in')) {
                                            logger.info(`[ChatStream] 拦截 Bash 天气查询`);
                                            const result = await execAsync(cmd, { encoding: 'utf-8', timeout: 12000 });
                                            return { hookSpecificOutput: { permissionDecision: 'allow', toolResult: result.stdout || '查询无结果' } };
                                        }
                                    }
                                    // 拦截 WebFetch 调用 - 用 curl 代替
                                    if (toolName === 'WebFetch') {
                                        const url = toolInput.url || '';
                                        if (url.startsWith('http')) {
                                            logger.info(`[ChatStream] 拦截 WebFetch: ${url}`);
                                            const result = await execAsync(`curl -s -L --max-time 10 -A "Mozilla/5.0" "${url}"`, { encoding: 'utf-8', timeout: 15000 });
                                            let text = (result.stdout || '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                                                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                                                .replace(/<[^>]+>/g, ' ')
                                                .replace(/\s+/g, ' ')
                                                .trim()
                                                .substring(0, 3000);
                                            return { hookSpecificOutput: { permissionDecision: 'allow', toolResult: text || '获取失败' } };
                                        }
                                    }
                                }
                                catch (err) {
                                    logger.error(`[ChatStream] 工具执行失败: ${err.message}`);
                                    return { hookSpecificOutput: { permissionDecision: 'allow', toolResult: `执行失败: ${err.message}` } };
                                }
                                // 其他工具正常执行
                                return { hookSpecificOutput: { permissionDecision: 'allow' } };
                            }
                        }]
                }
            };
            // 如果有已存在的SDK会话ID，使用resume复用会话
            if (existingSdkSessionId) {
                queryOptions.resume = existingSdkSessionId;
                logger.info(`[ChatStream] 复用SDK会话: ${existingSdkSessionId}`);
            }
            logger.info(`[ChatStream] 开始SDK调用, model=${resolvedModel}, resume=${!!existingSdkSessionId}, cwd=${CHAT_WORKSPACE}`);
            for await (const message of query({
                prompt: prompt,
                options: queryOptions
            })) {
                const elapsed = Date.now() - callStart;
                // 获取SDK会话ID（从init消息中）
                if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
                    newSdkSessionId = message.session_id;
                    ChatService._sdkSessionIds.set(sessionId, newSdkSessionId);
                    logger.info(`[ChatStream] SDK会话ID: ${newSdkSessionId} (${elapsed}ms)`);
                }
                else {
                    logger.info(`[ChatStream] 消息 type=${message.type}/${message.subtype || ''} (${elapsed}ms)`);
                }
                // 处理assistant消息（注意：消息在message.message.content中）
                if (message.type === 'assistant') {
                    const content = message.message?.content || [];
                    for (const block of content) {
                        if (block.type === 'text' && block.text) {
                            output += block.text;
                            logger.info(`[ChatStream] assistant text chunk: ${block.text.substring(0, 50)}`);
                            // 广播流式消息
                            if (this._broadcastService) {
                                this._broadcastService.broadcast('chat.stream', {
                                    sessionId,
                                    chunk: block.text,
                                    done: false
                                });
                                logger.info(`[ChatStream] broadcast done, clients: ${this._broadcastService.clients.size}`);
                            }
                            else {
                                logger.warn('[ChatStream] _broadcastService is null!');
                            }
                        }
                    }
                }
                // 处理result消息
                else if (message.type === 'result') {
                    logger.info(`[ChatStream] result: ${message.subtype}`);
                    if (message.subtype === 'success' && message.result) {
                        if (!output) {
                            output = message.result;
                            // 广播结果
                            if (this._broadcastService) {
                                this._broadcastService.broadcast('chat.stream', {
                                    sessionId,
                                    chunk: message.result,
                                    done: false
                                });
                            }
                        }
                    }
                    else if (message.subtype === 'error') {
                        throw new Error(message.error || '子Agent执行失败');
                    }
                    else if (message.subtype === 'error_max_turns') {
                        logger.warn(`[ChatStream] 达到最大轮次限制 (${10}轮)`);
                        // 不抛错，用已有的 output 继续
                        if (!output && message.result) {
                            output = message.result;
                        }
                    }
                }
            }
            // 广播完成
            if (this._broadcastService) {
                this._broadcastService.broadcast('chat.stream', {
                    sessionId,
                    chunk: '',
                    done: true
                });
            }
            clearTimeout(chatTimeout);
            return output || 'No response generated.';
        }
        catch (err) {
            clearTimeout(chatTimeout);
            logger.error('SDK调用失败:', err);
            throw new AppError('CLAUDE_ERROR', `SDK调用失败: ${err.message}`, 500);
        }
    }
    /**
     * 检查标题是否为默认值
     */
    static _isDefaultTitle(title) {
        if (!title)
            return true;
        return /^对话 \d{1,2}:\d{2}:\d{2}$/.test(title) || title === 'New Chat';
    }
    /**
     * 自动生成会话标题
     */
    static async _generateTitle(sessionId, messages) {
        const conversationSummary = messages
            .filter(m => m.role !== 'system')
            .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.substring(0, 100)}`)
            .join('\n');
        const prompt = `请根据以下对话内容，生成一个简短的标题（不超过20个字）。只输出标题本身，不要添加任何其他内容：\n\n${conversationSummary}`;
        try {
            const title = await this._callClaude(sessionId + '-title', prompt, 'haiku', '你是一个标题生成器。根据对话内容生成简洁的中文标题，不超过20个字。只输出标题。');
            const cleanTitle = title.replace(/["'""「」【】]/g, '').trim().substring(0, 30);
            if (cleanTitle) {
                ChatSessionModel.update(sessionId, { title: cleanTitle });
                if (this._broadcastService) {
                    this._broadcastService.broadcast('chat.titleUpdated', {
                        sessionId,
                        title: cleanTitle
                    });
                }
            }
        }
        catch (err) {
            logger.warn('Title generation failed', { sessionId, error: err.message });
        }
    }
}
// 使用 CommonJS 导出以保持与现有路由的兼容性
module.exports = ChatService;
module.exports.ChatService = ChatService;
module.exports.default = ChatService;
//# sourceMappingURL=ChatService.js.map