const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * Claude Code CLI integration service
 * Executes tasks by spawning `claude` CLI processes with streaming output.
 */
class ClaudeService {
  constructor(broadcastService) {
    this.broadcastService = broadcastService;
    this.activeProcesses = new Map(); // taskId -> { process, startedAt }
    this._taskWorkflowMap = new Map(); // taskId -> workflowId
  }

  /**
   * Get all file paths in a directory (non-recursive, skipping hidden and WORKFLOWS)
   */
  _getFilesSnapshot(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files = new Set();
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'WORKFLOWS' || entry.name === 'node_modules') continue;
        if (entry.isFile()) {
          files.add(entry.name);
        } else if (entry.isDirectory()) {
          // Scan one level deep
          try {
            const sub = fs.readdirSync(path.join(dir, entry.name), { withFileTypes: true });
            for (const s of sub) {
              if (s.isFile()) files.add(entry.name + '/' + s.name);
            }
          } catch (e) { /* ignore */ }
        }
      }
      return files;
    } catch (e) {
      return new Set();
    }
  }

  /**
   * Detect files that were likely generated outside the workspace
   * by scanning the project root for recently created files
   */
  _detectMisplacedFiles(workspaceDir, output) {
    const misplaced = [];
    try {
      // Check project root (parent of workspace)
      const projectRoot = path.resolve(workspaceDir, '..');
      const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
      const now = Date.now();
      const threshold = 60 * 1000; // 1 minute

      for (const entry of entries) {
        if (entry.isFile() && !entry.name.startsWith('.')) {
          const filePath = path.join(projectRoot, entry.name);
          try {
            const stat = fs.statSync(filePath);
            // If file was modified in the last minute and matches output keywords
            if (now - stat.mtimeMs < threshold) {
              const nameLower = entry.name.toLowerCase();
              if (nameLower.endsWith('.md') || nameLower.endsWith('.txt') || nameLower.endsWith('.json')) {
                misplaced.push({ name: entry.name, path: filePath });
              }
            }
          } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { /* ignore */ }
    return misplaced;
  }

  /**
   * Move misplaced files into the workspace directory
   * @returns {Array} Updated misplaced files list with new paths
   */
  _migrateMisplacedFiles(misplacedFiles, workspaceDir) {
    const migrated = [];
    for (const file of misplacedFiles) {
      try {
        const destPath = path.join(workspaceDir, file.name);
        // Avoid overwriting existing files
        if (fs.existsSync(destPath)) {
          const ext = path.extname(file.name);
          const base = path.basename(file.name, ext);
          const timestamp = Date.now();
          const newName = `${base}_${timestamp}${ext}`;
          const newDest = path.join(workspaceDir, newName);
          fs.renameSync(file.path, newDest);
          migrated.push({ name: newName, path: newDest, migrated: true, originalPath: file.path });
          logger.info(`Migrated misplaced file: ${file.path} -> ${newDest}`);
        } else {
          fs.renameSync(file.path, destPath);
          migrated.push({ name: file.name, path: destPath, migrated: true, originalPath: file.path });
          logger.info(`Migrated misplaced file: ${file.path} -> ${destPath}`);
        }
      } catch (e) {
        logger.warn(`Failed to migrate misplaced file ${file.path}: ${e.message}`);
        migrated.push(file);
      }
    }
    return migrated;
  }

  /**
   * Broadcast file generation info to all clients
   */
  _broadcastFilesGenerated(taskId, agentId, newFiles, misplacedFiles, workspaceDir) {
    if (!this.broadcastService) return;

    const payload = {
      taskId,
      agentId,
      workspaceDir,
      newFiles,        // Files correctly generated in workspace
      misplacedFiles,  // Files generated outside workspace
      timestamp: new Date().toISOString()
    };

    this.broadcastService.broadcast('files.generated', payload);

    // If there are misplaced files, also broadcast a warning
    if (misplacedFiles.length > 0) {
      this.broadcastService.broadcast('files.misplaced', {
        ...payload,
        message: `检测到 ${misplacedFiles.length} 个文件生成在工作区外`
      });
    }
  }

  /**
   * Execute a task via Claude Code CLI
   * @param {string} taskId - Task ID for tracking
   * @param {string} agentId - Agent ID for context
   * @param {string} prompt - The user prompt / task input
   * @param {object} config - Agent config
   * @param {string} config.systemPrompt - System prompt for the agent
   * @param {string} config.model - Claude model to use
   * @param {string} config.workingDir - Working directory for the CLI
   * @param {number} config.timeoutMs - Execution timeout (default 5 min)
   * @returns {Promise<string>} - The complete response output
   */
  async execute(taskId, agentId, prompt, config = {}) {
    // Circuit breaker: prevent cascading failures from repeated API errors
    const { circuits } = require('../utils/CircuitBreaker');
    const cb = circuits.default;
    return cb.call(async () => this._executeInternal(taskId, agentId, prompt, config));
  }

  async _executeInternal(taskId, agentId, prompt, config = {}) {
    // 保存当前执行的工作流上下文（用于广播）— 使用 per-task Map 避免并发竞争
    if (config?.workflowId) {
      this._taskWorkflowMap.set(taskId, config.workflowId);
    }

    // Store explicit runId/nodeId from config (avoids parsing them from taskId)
    if (config?.runId || config?.nodeId) {
      this._taskMetaMap = this._taskMetaMap || new Map();
      this._taskMetaMap.set(taskId, {
        runId: config.runId || null,
        nodeId: config.nodeId || null
      });
    }

    const userSystemPrompt = config.systemPrompt || '';
    const model = config.model || config_module.agent.defaultModel || 'sonnet';

    const config_module = require('../config');
    const folderPath = config.folderPath || null;
    const workingDir = folderPath || config.workingDir || config_module.workspaceRoot || process.cwd();
    const timeoutMs = config.timeoutMs || 30 * 60 * 1000; // 30 minutes default

    // Enforce workspace boundary: prepend hard constraint to system prompt
    const boundaryRule = `[关键安全规则 - 工作区沙箱]
你已被授予所有工具的完全权限，但必须在以下沙箱边界内运行：
工作区目录: "${workingDir}"

=== 硬约束（违反将导致任务失败） ===
1. 所有文件操作（read/write/delete/move/copy）必须严格限制在上述工作区目录内。
2. 严禁访问工作区外的任何路径，包括但不限于：系统目录(C:\\Windows, /etc, /home)、其他盘符(D:\\, E:\\)、用户目录、程序目录。
3. 严禁读取或修改以下系统目录：WORKFLOWS/、reports/、.context/、.BACKUP/、.checkpoint/ —— 这些目录包含系统配置、检查点、报告、记忆和备份数据。
4. 创建文件时始终使用相对于工作区目录的路径，不要使用绝对路径。
5. 如果你需要操作工作区外的文件，输出警告信息并跳过。不要尝试绕过沙箱。

=== 文件生成规则 ===
1. 必须使用 writeFile 工具将所有内容保存为文件。
2. 文件名要清晰描述内容（如 分析报告.md、result.json）。
3. 多步骤任务将中间结果保存为独立文件。

[默认行为 - 文件生成规则]
当你的任务涉及生成任何书面内容（文档、笔记、报告、代码、数据）时：
1. 你必须使用 writeFile 工具将输出保存为文件——绝不要仅以文本形式返回内容。
2. 使用具有描述性的文件名和适当的扩展名（如 python-guide.md、analysis-report.md、data-export.json）。
3. 如果同名文件已存在，先读取它然后追加，或创建带时间戳后缀的新版本。
4. 写入后，确认文件已创建，说明确切的文件路径。
5. 对于多步骤任务，将中间结果保存为单独的文件。

[错误处理]
如果遇到错误：
1. 文件操作错误：检查路径是否有效且在工作区内。
2. 任务失败：将错误详情保存到 error-log 文件，继续执行剩余步骤。
3. 绝不要静默忽略错误——始终在输出中报告。`;
    const systemPrompt = userSystemPrompt
      ? `${boundaryRule}\n\n${userSystemPrompt}`
      : boundaryRule;

    logger.info('Claude Code execution started', { taskId, agentId, model, workingDir });

    // Snapshot files before execution (for detecting new files)
    const filesBefore = this._getFilesSnapshot(workingDir);

    const args = [
      '--print',                    // Non-interactive mode
      '--model', model,
      '--output-format', 'stream-json', // Streaming JSON output
      '--verbose',                   // Required for stream-json with --print
      '--permission-mode', 'bypassPermissions', // Full auto-approve — agent is sandboxed by cwd + system prompt
    ];

    // systemPrompt 已通过 execDir/CLAUDE.md 注入，不再用命令行参数（避免 shell 转义问题）

    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';
      let killed = false;
      let stdoutBuffer = ''; // Line buffer for partial JSON chunks

      // 在工作目录下写 CLAUDE.md，确保 Agent 读取系统提示词
      // Agent 在工作目录（workingDir）下运行，所有生成文件直接落在工作区内
      const execDir = path.join(workingDir, '.agent-exec', taskId);
      try { fs.mkdirSync(execDir, { recursive: true }); } catch (_) { /* ignore */ }
      if (systemPrompt) {
        try {
          fs.writeFileSync(path.join(workingDir, 'CLAUDE.md'), systemPrompt, 'utf-8');
          fs.writeFileSync(path.join(execDir, 'CLAUDE.md'), systemPrompt, 'utf-8');
        } catch (_) { /* ignore */ }
      }

      const proc = spawn('claude', args, {
        cwd: workingDir,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        windowsHide: true,
        creationFlags: 0x08000000,
      });

      // 内存监控：定期检查进程内存，超限则 kill
      const MAX_MEMORY_MB = 2048; // 2GB 上限
      let memMonitor = null;
      if (proc.pid) {
        memMonitor = setInterval(() => {
          try {
            const { execSync } = require('child_process');
            // Windows: 用 wmic 查询进程内存
            const out = execSync(
              `wmic process where "ProcessId=${proc.pid}" get WorkingSetSize /value`,
              { encoding: 'utf-8', timeout: 5000, windowsHide: true }
            );
            const match = out.match(/WorkingSetSize=(\d+)/);
            if (match) {
              const memMB = parseInt(match[1], 10) / (1024 * 1024);
              if (memMB > MAX_MEMORY_MB) {
                logger.warn(`Agent ${taskId} exceeded memory limit (${memMB.toFixed(0)}MB > ${MAX_MEMORY_MB}MB), killing`);
                killed = true;
                proc.kill('SIGTERM');
                clearInterval(memMonitor);
              }
            }
          } catch (_) { /* wmic 失败不中断 */ }
        }, 10000); // 每 10 秒检查一次
      }

      // 执行结束后清理临时目录和根目录 CLAUDE.md
      const cleanupExecDir = () => {
        try { fs.rmSync(execDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
        try { fs.unlinkSync(path.join(workingDir, 'CLAUDE.md')); } catch (_) { /* ignore */ }
      };

      // Pass prompt via stdin (CLI reads from stdin in --print mode)
      proc.stdin.write(prompt);
      proc.stdin.end();

      proc.stdin.on('error', (err) => {
        logger.warn('stdin pipe error', { taskId, error: err.message });
      });

      this.activeProcesses.set(taskId, { process: proc, startedAt: new Date() });

      // Handle stdout (streaming JSON lines from Claude CLI)
      // Use a line buffer to handle chunks that split across multiple data events
      proc.stdout.on('data', (data) => {
        stdoutBuffer += data.toString();
        const parts = stdoutBuffer.split('\n');
        // Keep the last incomplete part in the buffer
        stdoutBuffer = parts.pop() || '';

        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const msg = JSON.parse(trimmed);

            if (msg.type === 'assistant' && msg.message?.content) {
              // Extract text from assistant message content blocks
              for (const block of msg.message.content) {
                if (block.type === 'text' && block.text) {
                  output += block.text;
                  this._broadcastChunk(taskId, agentId, block.text, false);
                }
              }
            } else if (msg.type === 'result' && msg.result) {
              // Final result message — use as definitive output
              output = msg.result;
              this._broadcastChunk(taskId, agentId, msg.result, false);
            }
          } catch {
            // Non-JSON output, treat as plain text chunk
            output += trimmed + '\n';
            this._broadcastChunk(taskId, agentId, trimmed + '\n', false);
          }
        }
      });

      proc.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      proc.on('close', (code) => {
        if (memMonitor) clearInterval(memMonitor);
        cleanupExecDir();
        this.activeProcesses.delete(taskId);
        this._taskWorkflowMap.delete(taskId);
        this._taskMetaMap?.delete(taskId);

        if (killed) {
          const timeoutErr = new AppError('TIMEOUT', 'Claude Code 执行超时（30分钟），已保存检查点可从断点恢复', 408);
          timeoutErr.errorType = 'TIMEOUT';
          timeoutErr.retryable = true;
          reject(timeoutErr);
          return;
        }

        if (code !== 0 && !output) {
          logger.error('Claude Code execution failed', { taskId, agentId, code, stderr: errorOutput });

          // Classify error type for better user feedback
          const errorInfo = ClaudeService.classifyError(errorOutput, code);
          const err = new AppError(errorInfo.type, errorInfo.message, errorInfo.statusCode);
          err.errorType = errorInfo.type;
          err.retryable = errorInfo.retryable;
          reject(err);
          return;
        }

        // Detect new files generated during execution
        const filesAfter = this._getFilesSnapshot(workingDir);
        const newFiles = [];
        for (const f of filesAfter) {
          if (!filesBefore.has(f)) {
            newFiles.push({ name: f, path: path.join(workingDir, f) });
          }
        }

        // Scan project root for files generated outside workspace (common mistake)
        let misplacedFiles = this._detectMisplacedFiles(workingDir, output);

        // Auto-migrate misplaced files into workspace
        if (misplacedFiles.length > 0) {
          misplacedFiles = this._migrateMisplacedFiles(misplacedFiles, workingDir);
        }

        // Broadcast file generation info
        if (newFiles.length > 0 || misplacedFiles.length > 0) {
          this._broadcastFilesGenerated(taskId, agentId, newFiles, misplacedFiles, workingDir);
        }

        // Send completion signal
        this._broadcastChunk(taskId, agentId, '', true);

        logger.info('Claude Code execution completed', { taskId, agentId, outputLength: output.length, newFiles: newFiles.length });
        resolve(output);
      });

      proc.on('error', (err) => {
        this.activeProcesses.delete(taskId);
        this._taskWorkflowMap.delete(taskId);
        this._taskMetaMap?.delete(taskId);

        if (err.code === 'ENOENT') {
          logger.error('Claude Code CLI not found. Make sure `claude` is installed and in PATH.');
          const cliErr = new AppError('CLI_NOT_FOUND', 'Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code', 500);
          cliErr.errorType = 'CLI_NOT_FOUND';
          cliErr.retryable = false;
          reject(cliErr);
          return;
        }

        logger.error('Claude Code process error', { taskId, agentId, error: err.message });
        const execErr = new AppError('EXECUTION_ERROR', err.message, 500);
        execErr.errorType = 'EXECUTION_ERROR';
        execErr.retryable = false;
        reject(execErr);
      });

      // Timeout handling
      const timer = setTimeout(() => {
        if (this.activeProcesses.has(taskId)) {
          killed = true;
          proc.kill('SIGTERM');
          logger.warn('Claude Code execution timed out', { taskId, agentId, timeoutMs });
        }
      }, timeoutMs);

      proc.on('close', () => clearTimeout(timer));
    });
  }

  /**
   * Broadcast a streaming chunk to all connected WebSocket clients
   */
  _broadcastChunk(taskId, agentId, chunk, isComplete) {
    if (this.broadcastService) {
      const meta = this._taskMetaMap?.get(taskId) || {};
      const runId = meta.runId || taskId;
      const nodeId = meta.nodeId || null;

      this.broadcastService.broadcast('claude.stream', {
        taskId,
        agentId,
        workflowId: this._taskWorkflowMap.get(taskId) || null,
        nodeId,
        runId,
        chunk,
        isComplete,
      });
    }
  }

  /**
   * Cancel an active execution
   */
  cancel(taskId) {
    const entry = this.activeProcesses.get(taskId);
    if (entry) {
      entry.process.kill('SIGTERM');
      this.activeProcesses.delete(taskId);
      logger.info('Claude Code execution cancelled', { taskId });
      return true;
    }
    return false;
  }

  /**
   * Get count of active processes
   */
  getActiveCount() {
    return this.activeProcesses.size;
  }

  /**
   * Check if Claude Code CLI is available and compatible
   */
  async checkAvailability() {
    return new Promise((resolve) => {
      // execFile + shell:true needed on Windows to find .cmd/.bat files
      // timeout ensures no permanent hang
      execFile('claude', ['--version'], {
        windowsHide: true, shell: true, timeout: 4000,
      }, (error, stdout) => {
        if (error) {
          resolve({ available: false, version: null, compatible: false,
            message: error.killed ? 'timeout' : 'Claude CLI not found' });
        } else {
          const version = (stdout || '').trim();
          const compatibility = this._checkCompatibility(version);
          resolve({ available: true, version, ...compatibility });
        }
      });
    });
  }

  /**
   * Check CLI version compatibility
   */
  _checkCompatibility(version) {
    // Extract version number (e.g., "2.1.143" from "claude-code 2.1.143 (Claude Code)")
    const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) {
      return { compatible: true, message: 'Version format unknown, assuming compatible' };
    }

    const major = parseInt(match[1]);
    const minor = parseInt(match[2]);
    const patch = parseInt(match[3]);

    // Minimum required version: 2.0.0
    if (major < 2) {
      return {
        compatible: false,
        message: `Version ${version} is too old. Minimum required: 2.0.0. Please update with: npm install -g @anthropic-ai/claude-code`
      };
    }

    // Check for known breaking changes
    const warnings = [];

    // Version 2.x should be compatible
    if (major === 2) {
      // All 2.x versions should work
      return { compatible: true, message: null, warnings };
    }

    // Version 3.x+ - might have breaking changes
    if (major >= 3) {
      warnings.push(`Version ${version} is newer than tested. Some features may not work as expected.`);
    }

    return { compatible: true, message: null, warnings };
  }

  /**
   * Classify CLI errors for better user feedback
   * @param {string} stderr - Standard error output
   * @param {number} exitCode - Process exit code
   * @returns {{ type: string, message: string, statusCode: number, retryable: boolean }}
   */
  static classifyError(stderr, exitCode) {
    const s = (stderr || '').toLowerCase();

    // Token / quota errors
    if (s.includes('token') && (s.includes('limit') || s.includes('exceed') || s.includes('exhaust') || s.includes('quota'))) {
      return {
        type: 'TOKEN_EXHAUSTED',
        message: 'Token 额度已耗尽，请检查账户额度或稍后重试。已保存检查点，可从断点恢复。',
        statusCode: 429,
        retryable: true
      };
    }
    if (s.includes('rate_limit') || s.includes('rate limit') || s.includes('too many requests')) {
      return {
        type: 'RATE_LIMITED',
        message: 'API 请求频率超限，请稍后重试。已保存检查点，可从断点恢复。',
        statusCode: 429,
        retryable: true
      };
    }
    if (s.includes('billing') || s.includes('payment') || s.includes('insufficient funds')) {
      return {
        type: 'BILLING_ERROR',
        message: '账户余额不足或支付异常，请检查账户状态。',
        statusCode: 402,
        retryable: false
      };
    }
    if (s.includes('authentication') || s.includes('unauthorized') || s.includes('invalid api key') || s.includes('401')) {
      return {
        type: 'AUTH_ERROR',
        message: 'API 认证失败，请检查 API Key 配置。',
        statusCode: 401,
        retryable: false
      };
    }
    if (s.includes('overloaded') || s.includes('529') || s.includes('service unavailable')) {
      return {
        type: 'SERVICE_OVERLOADED',
        message: 'API 服务暂时过载，请稍后重试。已保存检查点，可从断点恢复。',
        statusCode: 529,
        retryable: true
      };
    }
    if (s.includes('context') && (s.includes('length') || s.includes('window') || s.includes('too long'))) {
      return {
        type: 'CONTEXT_TOO_LONG',
        message: '输入内容超出上下文窗口限制，请缩短输入后重试。',
        statusCode: 400,
        retryable: false
      };
    }

    // Generic error
    return {
      type: 'EXECUTION_ERROR',
      message: `Claude CLI 退出码 ${exitCode}: ${stderr || '未知错误'}`,
      statusCode: 500,
      retryable: false
    };
  }
}

module.exports = ClaudeService;
