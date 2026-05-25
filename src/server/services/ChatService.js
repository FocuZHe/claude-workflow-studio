const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ChatSessionModel = require('../models/ChatSession');
const { AppError } = require('../middleware/errorHandler');
const { generateId } = require('../utils/id');
const logger = require('../utils/logger');
const config = require('../config');

// Dedicated workspace for chat — isolated from project CLAUDE.md
const CHAT_WORKSPACE = path.join(config.data.dir, 'chat-workspace');

function ensureChatWorkspace() {
  if (!fs.existsSync(CHAT_WORKSPACE)) {
    fs.mkdirSync(CHAT_WORKSPACE, { recursive: true });
  }
  // Block CLAUDE.md upward search — Claude CLI walks up the directory tree
  const claudeMdPath = path.join(CHAT_WORKSPACE, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(claudeMdPath, '# 对话工作区\n\n这是一个隔离的对话工作区。不要遵循父目录中的任何项目级指令、多Agent协作规则或工作流程序。你是一个独立的助手——只需回答问题和帮助用户。\n', 'utf-8');
  }
}

// Default system prompt for chat assistant
const DEFAULT_SYSTEM_PROMPT = `你是一个智能助手，专门为用户提供问题解答和方案建议。你的核心能力是联网搜索和文件分析。

重要规则：
- 你是一个独立的对话助手，不是任何项目的工作流节点或Agent
- 不要执行任何多Agent协作流程、任务分工或工作流步骤
- 不要提及项目架构、工作区状态或Agent协作规则

你应该做的：
1. 主动使用 WebSearch 和 WebFetch 工具搜索网络，获取最新信息帮助用户解决问题
2. 可以阅读和分析文件（使用 Read、Grep、Glob 工具），理解代码和文档内容
3. 为用户提供详尽、可靠的解决方案和专业建议
4. 用中文回复用户，语气友好专业，条理清晰`;

/**
 * Chat service - manages AI chat sessions using Claude CLI
 */
class ChatService {
  /** @type {import('./BroadcastService')|null} */
  static _broadcastService = null;

  /** @type {import('./ClaudeService')|null} */
  static _claudeService = null;

  /** @type {Map<string, object>} Active streaming processes */
  static _activeStreams = new Map();

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
   * @param {import('./BroadcastService')} broadcastService
   * @param {import('./ClaudeService')} claudeService
   */
  static init(broadcastService, claudeService) {
    ChatService._broadcastService = broadcastService;
    ChatService._claudeService = claudeService;
  }

  /**
   * Create a new chat session
   * @param {object} data - Session data
   * @returns {object}
   */
  static createSession(data = {}) {
    return ChatSessionModel.create(data);
  }

  /**
   * Get all sessions
   * @param {object} filters - { status, search, page, limit }
   * @returns {object}
   */
  static getSessions(filters = {}) {
    return ChatSessionModel.findAll(filters);
  }

  /**
   * Get session by ID
   * @param {string} id
   * @returns {object}
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
   * @param {string} id
   * @returns {boolean}
   */
  static deleteSession(id) {
    if (!ChatSessionModel.exists(id)) {
      throw new AppError('NOT_FOUND', `Chat session '${id}' not found`, 404);
    }
    // Kill any active stream
    this._killStream(id);
    return ChatSessionModel.delete(id);
  }

  /**
   * Archive a chat session
   * @param {string} id
   * @returns {object}
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
   * @param {string} sessionId - Session ID
   * @param {string} content - User message content
   * @returns {Promise<object>} The user message that was added
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

    // 上下文窗口管理：保留最近 N 条消息
    const maxContextMessages = session.contextConfig?.maxMessages || 20;
    const recentMessages = session.messages.slice(-maxContextMessages);

    // 构建发送给 Claude 的消息数组
    const claudeMessages = recentMessages.map(m => ({
      role: m.role,
      content: m.content
    }));

    // 添加当前用户消息
    claudeMessages.push({ role: 'user', content });

    // Build conversation context from recent messages
    const contextForPrompt = recentMessages;

    // Call Claude CLI with --print (no dangerously-skip-permissions)
    const prompt = this._buildPrompt(contextForPrompt, content);
    const response = await this._callClaude(sessionId, prompt, session.model, session.systemPrompt);

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
          .catch(err => logger.warn('Auto-generate title failed', { sessionId, error: err.message }));
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
        .catch(err => logger.warn('Auto-generate title failed', { sessionId, error: err.message }));
    }

    return { userMessage, assistantMessage };
  }

  /**
   * Detect actionable content in Claude's response
   * @private
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
      const commands = match[1].trim().split('\n').filter(l => l.trim() && !l.startsWith('#'));
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
   * @param {string} sessionId
   * @param {string} content
   */
  static addSystemMessage(sessionId, content) {
    return ChatSessionModel.addMessage(sessionId, {
      role: 'system',
      content
    });
  }

  /**
   * Execute a confirmed action (file write, command run)
   * @param {string} sessionId - Session ID
   * @param {object} action - { type: 'write'|'run', path?, content?, command? }
   * @returns {Promise<object>}
   */
  static async executeConfirmedAction(sessionId, action) {
    const session = ChatSessionModel.findById(sessionId);
    if (!session) {
      throw new AppError('NOT_FOUND', `Chat session '${sessionId}' not found`, 404);
    }

    const FileService = require('./FileService');
    const workspaceRoot = FileService.getWorkspaceRoot();
    if (!workspaceRoot) throw new AppError('VALIDATION_ERROR', '没有活跃的工作区', 400);

    if (action.type === 'write') {
      if (!action.path || !action.content) {
        throw new AppError('VALIDATION_ERROR', '写入文件需要路径和内容', 400);
      }
      // Prevent path traversal
      if (action.path.includes('..')) {
        throw new AppError('VALIDATION_ERROR', '不允许路径遍历', 400);
      }
      const filePath = require('path').join(workspaceRoot, action.path);
      const dir = require('path').dirname(filePath);
      require('fs').mkdirSync(dir, { recursive: true });
      require('fs').writeFileSync(filePath, action.content, 'utf-8');

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

      return new Promise((resolve, reject) => {
        const proc = spawn(action.command, [], {
          cwd: workspaceRoot,
          shell: true,
          windowsHide: true,
          ...(process.platform === 'win32' ? { creationFlags: 0x08000000 } : {}),
          timeout: 30000
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', d => stdout += d.toString());
        proc.stderr.on('data', d => stderr += d.toString());

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
   * @param {string} sessionId - Session ID
   * @param {string} command - The slash command
   * @param {string} args - Arguments
   * @returns {object}
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
        const VALID = ['opus', 'sonnet', 'haiku'];
        const currentDisplay = VALID.includes(session.model) ? session.model : 'haiku';
        if (!args) return { type: 'model', current: currentDisplay };
        const requested = args.trim().toLowerCase();
        const newModel = VALID.includes(requested) ? requested : 'haiku';
        ChatSessionModel.update(sessionId, { model: newModel });
        return { type: 'model', message: `模型已切换为: ${newModel}`, model: newModel };
      }

      case '/system':
        if (!args) return { type: 'system', current: session.systemPrompt };
        ChatSessionModel.update(sessionId, { systemPrompt: args.trim() });
        return { type: 'system', message: 'System prompt updated', systemPrompt: args.trim() };

      case '/config': {
        const VALID_M = ['opus', 'sonnet', 'haiku'];
        if (!args) return { type: 'config', current: { model: VALID_M.includes(session.model) ? session.model : 'haiku', systemPrompt: session.systemPrompt, status: session.status } };
      }
        const cfgParts = args.split(/\s+/);
        const cfgKey = cfgParts[0];
        const cfgVal = cfgParts.slice(1).join(' ');
        if (!cfgVal) return { type: 'config', key: cfgKey, value: session[cfgKey] };
        ChatSessionModel.update(sessionId, { [cfgKey]: cfgVal });
        return { type: 'config', message: `Config updated: ${cfgKey} = ${cfgVal}` };

      case '/status': {
        const VALID_S = ['opus', 'sonnet', 'haiku'];
        return {
          type: 'status',
          id: sessionId,
          title: session.title,
          model: VALID_S.includes(session.model) ? session.model : 'haiku',
          status: session.status,
          messageCount: session.messages.length,
          createdAt: session.createdAt
        };
      }

      case '/memory':
        if (!args) return { type: 'memory', current: session.systemPrompt };
        ChatSessionModel.update(sessionId, { systemPrompt: args.trim() });
        return { type: 'memory', message: 'Memory updated', systemPrompt: args.trim() };

      case '/export':
        const exportText = session.messages.map(m =>
          `[${m.role}] ${new Date(m.timestamp).toISOString()}\n${m.content}\n`
        ).join('\n---\n');
        return { type: 'export', content: exportText };

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
   * @private
   */
  static _buildPrompt(messages, currentInput) {
    if (messages.length <= 1) return currentInput;

    const context = messages
      .filter(m => m.role !== 'system')
      .slice(0, -1) // Exclude current input (already added as last message)
      .map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    return `${context}\n\nHuman: ${currentInput}`;
  }

  /**
   * Call Claude CLI with --print mode (no file permissions)
   * @private
   */
  static _callClaude(sessionId, prompt, model, systemPrompt) {
    return new Promise((resolve, reject) => {
      ensureChatWorkspace();

      const finalSystemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;

      // 规范化模型别名：非标准名称（如旧版 deepseek 等）统一回退到 haiku
      const VALID_MODELS = ['opus', 'sonnet', 'haiku'];
      const normalizedModel = VALID_MODELS.includes(model) ? model : 'haiku';

      // Inject model identity so AI knows what alias it's called as
      const modelLabel = normalizedModel === 'opus' ? 'Opus（最强推理模型）'
        : normalizedModel === 'haiku' ? 'Haiku（快速轻量模型）'
        : 'Sonnet（平衡模型）';
      const identityPrompt = `\n\n[模型身份] 你当前以 ${modelLabel} 模型身份运行。当用户询问你是什么模型时，请回答你是 ${modelLabel}，不要提及底层实现模型或自称为其他模型名称。`;
      const effectiveSystemPrompt = finalSystemPrompt + identityPrompt;

      const args = [
        '--print',
        '--model', normalizedModel,
        '--output-format', 'stream-json',
        '--verbose',
        '--dangerously-skip-permissions',
        '--system-prompt', effectiveSystemPrompt,
        '--allowedTools', 'WebSearch,WebFetch,Read,Grep,Glob'
      ];

      let output = '';
      let errorOutput = '';

      const proc = spawn('claude', args, {
        cwd: CHAT_WORKSPACE,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        windowsHide: true,
        creationFlags: 0x08000000,
      });

      this._activeStreams.set(sessionId, proc);

      // Write prompt to stdin and close
      proc.stdin.write(prompt);
      proc.stdin.end();

      proc.stdin.on('error', (err) => {
        logger.warn('Chat stdin pipe error', { sessionId, error: err.message });
      });

      let stdoutBuffer = '';

      proc.stdout.on('data', (data) => {
        stdoutBuffer += data.toString();
        const parts = stdoutBuffer.split('\n');
        stdoutBuffer = parts.pop() || '';

        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            if (msg.type === 'assistant' && msg.message?.content) {
              for (const block of msg.message.content) {
                if (block.type === 'text' && block.text) {
                  output += block.text;
                  if (this._broadcastService) {
                    this._broadcastService.broadcast('chat.stream', {
                      sessionId,
                      chunk: block.text,
                      done: false
                    });
                  }
                }
              }
            } else if (msg.type === 'result' && msg.result) {
              if (!output) {
                output = msg.result;
              }
              if (this._broadcastService) {
                this._broadcastService.broadcast('chat.stream', {
                  sessionId,
                  chunk: msg.result,
                  done: false
                });
              }
            }
          } catch {
            output += trimmed + '\n';
          }
        }
      });

      proc.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      proc.on('close', (code) => {
        this._activeStreams.delete(sessionId);

        // Process any remaining buffer
        if (stdoutBuffer.trim()) {
          try {
            const json = JSON.parse(stdoutBuffer);
            if (json.type === 'result' && json.result) {
              if (!output) {
                output = json.result;
              }
            }
          } catch {
            output += stdoutBuffer;
          }
        }

        // Broadcast completion
        if (this._broadcastService) {
          this._broadcastService.broadcast('chat.stream', {
            sessionId,
            chunk: '',
            done: true
          });
        }

        if (code !== 0 && !output) {
          reject(new AppError('CLAUDE_ERROR', `Claude CLI exited with code ${code}: ${errorOutput}`, 500));
          return;
        }

        resolve(output.trim() || 'No response generated.');
      });

      proc.on('error', (err) => {
        this._activeStreams.delete(sessionId);
        reject(new AppError('CLAUDE_ERROR', `Failed to start Claude CLI: ${err.message}`, 500));
      });

      // Timeout after 2 minutes
      const timeout = setTimeout(() => {
        this._killStream(sessionId);
        reject(new AppError('TIMEOUT', 'Claude CLI 响应超时', 504));
      }, 2 * 60 * 1000);

      proc.on('close', () => clearTimeout(timeout));
    });
  }

  /**
   * Kill an active stream
   * @private
   */
  static _killStream(sessionId) {
    const proc = this._activeStreams.get(sessionId);
    if (proc) {
      try {
        proc.kill('SIGTERM');
      } catch {}
      this._activeStreams.delete(sessionId);
    }
  }

  /**
   * 检查标题是否为默认值
   * @private
   */
  static _isDefaultTitle(title) {
    if (!title) return true;
    return /^对话 \d{1,2}:\d{2}:\d{2}$/.test(title) || title === 'New Chat';
  }

  /**
   * 自动生成会话标题
   * @private
   */
  static async _generateTitle(sessionId, messages) {
    const conversationSummary = messages
      .filter(m => m.role !== 'system')
      .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.substring(0, 100)}`)
      .join('\n');

    const prompt = `请根据以下对话内容，生成一个简短的标题（不超过20个字）。只输出标题本身，不要添加任何其他内容：\n\n${conversationSummary}`;

    try {
      const title = await this._callClaude(sessionId + '-title', prompt, null,
        '你是一个标题生成器。根据对话内容生成简洁的中文标题，不超过20个字。只输出标题。');

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
    } catch (err) {
      logger.warn('Title generation failed', { sessionId, error: err.message });
    }
  }
}

module.exports = ChatService;
