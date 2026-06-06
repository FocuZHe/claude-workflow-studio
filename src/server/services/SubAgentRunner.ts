/**
 * SubAgentRunner — 子Agent物理进程与安全管理器
 *
 * 基于 Claude Agent SDK 的 query() 函数，管理子Agent的生命周期：
 * - 进程启动/停止/超时控制
 * - 50ms输出防抖（防止前端渲染卡死）
 * - Session ID 捕获（支持断点恢复）
 * - PreToolUse 安全拦截
 */

import { query, type PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = require('../utils/logger');
const ApiKeyService = require('./ApiKeyService');

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface AgentTask {
  id: string;
  description: string;
  model?: string;
  worktree: string;
  timeout?: number;
  resumeSessionId?: string; // 支持历史会话恢复
  systemPrompt?: string; // 系统提示词（通过 systemPrompt 参数传递，而不是拼接到 prompt 中）
  skills?: string[]; // 技能列表（自动加载 SKILL.md 文件）
}

export interface SubAgentConfig {
  id: string;
  name: string;
  baseSystemPrompt: string; // 预设死的"人设"和"核心规则"
  allowedTools: string[];   // 限制该子Agent的物理工具集
  model?: string;
  timeout?: number;
}

export type SubAgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'aborted';

// ── SubAgentRunner 类 ──────────────────────────────────────────────────────────

export class SubAgentRunner extends EventEmitter {
  public id: string;
  private abortController: AbortController;
  private status: SubAgentStatus = 'idle';
  private runningPromise?: Promise<string>;
  private sessionId?: string;
  private logDir: string;

  constructor(id: string, logDir: string) {
    super();
    this.id = id;
    this.logDir = logDir;
    this.abortController = new AbortController();
  }

  /**
   * 启动子Agent执行任务
   * @param task 任务定义
   * @param allowedTools 允许的工具列表
   * @returns 执行结果
   */
  public async start(task: AgentTask, allowedTools: string[]): Promise<string> {
    if (this.status === 'running') {
      throw new Error(`SubAgent ${this.id} 已经在运行中。`);
    }

    this.status = 'running';
    this.emit('started', { id: this.id, timestamp: new Date() });

    const timeoutMs = task.timeout || 15 * 60 * 1000; // 默认15分钟
    const timeoutId = setTimeout(() => {
      this.abortController.abort('TIMEOUT');
    }, timeoutMs);

    this.runningPromise = (async () => {
      try {
        // 从 ApiKeyService 获取 API 配置并设置环境变量
        const clientConfig = ApiKeyService.getClientConfig();
        const env: Record<string, string | undefined> = {
          ...process.env,
          ANTHROPIC_API_KEY: clientConfig.apiKey,
        };
        if (clientConfig.baseUrl) {
          env.ANTHROPIC_BASE_URL = clientConfig.baseUrl;
        }

        const queryOptions: any = {
          model: task.model || 'sonnet',
          allowedTools: allowedTools,
          cwd: task.worktree, // 绑定物理隔离工作区
          signal: this.abortController.signal,
          env: env,
          systemPrompt: task.systemPrompt, // 系统提示词通过 systemPrompt 参数传递
          skills: task.skills, // 技能列表（自动加载 SKILL.md 文件）
          permissionMode: 'bypassPermissions', // 跳过所有权限审批

          hooks: {
            // 安全阻断拦截钩子（含文件路径限制）
            PreToolUse: [{
              matcher: '.*',
              callback: async (input: PreToolUseHookInput) => {
                // 文件路径安全检查
                const toolName = input.tool_name;
                const toolInput = input.tool_input as any;
                const workspaceRoot = task.worktree;

                // 需要检查路径的工具
                const pathTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
                if (pathTools.includes(toolName) && workspaceRoot) {
                  const filePath = toolInput?.file_path || toolInput?.path || '';
                  if (filePath) {
                    const resolved = path.resolve(filePath);
                    const normalizedRoot = path.resolve(workspaceRoot);
                    if (!resolved.startsWith(normalizedRoot)) {
                      logger.warn(`[安全] 拒绝访问工作区外文件: ${filePath}`);
                      return { hookSpecificOutput: { permissionDecision: 'deny' } };
                    }
                  }
                }

                // Bash 命令检查
                if (toolName === 'Bash' && toolInput?.command) {
                  const cmd = toolInput.command;
                  // 阻止高危删除操作
                  if (/rm\s+-rf/.test(cmd)) {
                    logger.warn(`[安全] 拒绝高危删除操作: ${cmd}`);
                    return { hookSpecificOutput: { permissionDecision: 'deny' } };
                  }
                }

                return new Promise((resolve) => {
                  this.emit('security_check', {
                    toolName: input.tool_name,
                    toolInput: input.tool_input,
                    approve: () => resolve({ hookSpecificOutput: { permissionDecision: 'allow' } }),
                    deny: () => resolve({ hookSpecificOutput: { permissionDecision: 'deny' } })
                  });
                });
              }
            }],

            // 自动上下文压缩前进行历史归档
            PreCompact: [{
              matcher: '.*',
              callback: async (input: any) => {
                const archivePath = path.join(this.logDir, `${this.id}_pre_compact.json`);
                try {
                  await fs.mkdir(path.dirname(archivePath), { recursive: true });
                  await fs.writeFile(archivePath, JSON.stringify(input.messages, null, 2));
                  this.emit('sys_log', { text: `[系统] 上下文即将自动压缩，原始会话已备份至本地归档。` });
                } catch (err: any) {
                  logger.error('会话历史归档失败', err.message);
                }
                return {};
              }
            }],

            // 工具运行失败自愈与引导提示注入
            PostToolUseFailure: [{
              matcher: '.*',
              callback: async (input: any) => {
                let diagnosticTip = '请检查命令参数或路径。';
                if (input.tool_name === 'Bash' && input.error.includes('command not found')) {
                  diagnosticTip = '由于缺少环境依赖导致失败。请优先尝试使用包管理器将其安装，再重复上述任务。';
                }
                return {
                  hookSpecificOutput: {
                    injectedErrorExplanation: diagnosticTip
                  }
                };
              }
            }],

            // 动态指令与预算护栏注入
            UserPromptSubmit: [{
              matcher: '.*',
              callback: async (input: any) => {
                const limitInstruction = `\n\n[Master实时护栏指令]: 请优先使用极简、高效率的工具组合，禁止发生高频循环。`;
                return {
                  hookSpecificOutput: {
                    systemMessage: limitInstruction
                  }
                };
              }
            }]
          }
        };

        // 如果存在历史会话，执行热断点恢复
        if (task.resumeSessionId) {
          queryOptions.resume = task.resumeSessionId;
          this.emit('sys_log', { text: `[系统] 重建物理会话: [${task.resumeSessionId}]。正在恢复上下文状态...` });
        }

        const stream = query({
          prompt: task.description,
          options: queryOptions
        });

        // 引入 50ms 字符防抖，规避高频渲染卡死前端
        let chunkBuffer = '';
        let debounceTimeout: NodeJS.Timeout | null = null;

        for await (const message of stream) {
          if (this.abortController.signal.aborted) {
            throw new Error(this.abortController.signal.reason || 'ABORTED');
          }

          // 捕获物理会话 ID 并向 Master 报告
          if (message.session_id && !this.sessionId) {
            this.sessionId = message.session_id;
            this.emit('session_captured', { id: this.id, sessionId: this.sessionId });
          }

          if (message.type === 'assistant') {
            const textBlocks = message.message?.content?.filter((b: any) => b.type === 'text') || [];
            for (const block of textBlocks) {
              if ('text' in block) {
                chunkBuffer += block.text;
              }
              if (!debounceTimeout) {
                debounceTimeout = setTimeout(() => {
                  this.emit('progress', { id: this.id, text: chunkBuffer });
                  chunkBuffer = '';
                  debounceTimeout = null;
                }, 50); // 50ms 缓冲池合并输出
              }
            }
          } else if (message.type === 'result') {
            if (message.subtype === 'success') {
              this.status = 'completed';
              clearTimeout(timeoutId);
              if (debounceTimeout) clearTimeout(debounceTimeout);
              this.emit('completed', { id: this.id, result: message.result });
              return message.result;
            } else {
              throw new Error('子进程异常中断');
            }
          }
        }

        // 如果流结束但没有result消息
        throw new Error('子Agent流结束但未返回结果');
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.message === 'TIMEOUT' || err.message === 'ABORTED' || this.abortController.signal.aborted) {
          this.status = 'aborted';
          this.emit('aborted', { id: this.id, reason: err.message });
        } else {
          this.status = 'failed';
          this.emit('failed', { id: this.id, error: err.message });
        }
        throw err;
      }
    })();

    return this.runningPromise;
  }

  /**
   * 强制终止子Agent
   */
  public kill() {
    if (this.status === 'running') {
      this.abortController.abort('ABORTED');
    }
  }

  /**
   * 获取当前状态
   */
  public getStatus(): SubAgentStatus {
    return this.status;
  }

  /**
   * 获取会话ID（用于断点恢复）
   */
  public getSessionId(): string | undefined {
    return this.sessionId;
  }
}
