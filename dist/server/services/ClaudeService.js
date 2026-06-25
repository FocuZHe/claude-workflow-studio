"use strict";
/**
 * ClaudeService - 使用 Claude CLI 实现子Agent管理
 * 通过 spawn 子进程调用 Claude CLI
 *
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeService = void 0;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const events_1 = require("events");
class ClaudeService extends events_1.EventEmitter {
    broadcastService;
    activeProcesses;
    _taskWorkflowMap;
    _taskMetaMap;
    constructor(broadcastService) {
        super();
        this.broadcastService = broadcastService;
        this.activeProcesses = new Map();
        this._taskWorkflowMap = new Map();
        this._taskMetaMap = new Map();
    }
    /**
     * 执行 Claude CLI 任务
     */
    async execute(taskId, agentId, prompt, config = {}) {
        // Circuit breaker: prevent cascading failures from repeated API errors
        const { circuits } = require('../utils/CircuitBreaker');
        const cb = circuits.default;
        return cb.call(async () => this._executeInternal(taskId, agentId, prompt, config));
    }
    /**
     * 内部执行方法
     */
    async _executeInternal(taskId, agentId, prompt, config = {}) {
        // 保存当前执行的工作流上下文
        if (config?.workflowId) {
            this._taskWorkflowMap.set(taskId, config.workflowId);
        }
        // Store explicit runId/nodeId from config
        if (config?.runId || config?.nodeId) {
            this._taskMetaMap = this._taskMetaMap || new Map();
            this._taskMetaMap.set(taskId, {
                runId: config.runId || null,
                nodeId: config.nodeId || null,
            });
        }
        const userSystemPrompt = config.systemPrompt || '';
        const model = config.model || 'sonnet';
        const configModule = require('../config');
        const folderPath = config.folderPath || null;
        const workingDir = folderPath || config.workingDir || configModule.workspaceRoot || process.cwd();
        const timeoutMs = config.timeoutMs !== undefined ? config.timeoutMs : 30 * 60 * 1000; // 30 minutes default
        // Enforce workspace boundary
        const boundaryRule = `[关键安全规则 - 工作区沙箱]
你已被授予所有工具的完全权限，但必须在以下沙箱边界内运行：
工作区目录: "${workingDir}"

=== 硬约束（违反将导致任务失败） ===
1. 所有文件操作（read/write/delete/move/copy）必须严格限制在上述工作区目录内。
2. 严禁访问工作区外的任何路径。
3. 严禁读取修改以下系统目录：WORKFLOWS/、reports/、.context/、.BACKUP/
4. 创建文件时始终使用相对于工作区目录的路径。
5. 如果需要启动服务器或监听端口，必须使用 8000-8999 范围内的端口。

=== 文件生成规则 ===
1. 必须使用 writeFile 工具将所有内容保存为文件。
2. 文件名要清晰描述内容。
3. 多步骤任务将中间结果保存为独立文件。
4. 生成代码时，如果需要启动服务器，请使用 8000-8999 范围内的端口。

=== 平台相关命令（必须严格遵守）===
当前运行在 Windows 系统，已提供命令转换包装脚本 bash-wrapper.sh。

使用方式：
- 调用 bash 工具时，命令会自动转换为 Windows 命令
- 例如：bash pkill -f "node server.js" → 自动转换为 taskkill //F //IM node.exe

支持的命令转换：
- pkill/kill/killall → taskkill
- lsof/fuser → netstat
- ps/top → tasklist
- rm -rf → rmdir /s /q
- cat → type
- grep → findstr
- ls → dir
- mv → move
- cp → copy/xcopy
- chmod/chown → icacls/takeown
- find → findstr
- diff → fc
- touch → type nul >
- ln -s → mklink
- du/df → dir/wmic
- which → where
- man → help

如果你需要终止占用特定端口的进程，使用：
1. bash lsof :8000  // 查找占用端口的进程（自动转换为 netstat）
2. bash kill <pid>  // 终止进程（自动转换为 taskkill）

严禁直接使用 Linux/Mac 命令（如 pkill、lsof、rm -rf 等），必须通过 bash 工具调用，由包装脚本自动转换。

[默认行为 - 文件生成规则]
当你的任务涉及生成任何书面内容时：
1. 你必须使用 writeFile 工具将输出保存为文件
2. 使用具有描述性的文件名和适当的扩展名
3. 如果同名文件已存在，先读取它然后追加，或创建带时间戳后缀的新版本
4. 写入后，确认文件已创建，说明确切的文件路径
5. 对于多步骤任务，将中间结果保存为单独的文件

[错误处理]
如果遇到错误：
1. 文件操作错误：检查路径是否有效且在工作区内
2. 任务失败：将错误详情保存到 error-log 文件，继续执行剩余步骤
3. 绝不要静默忽略错误——始终在输出中报告

[工具权限限制 — 必须严格遵守]
✓ 允许: read、write、execute、search、grep、glob、list、webfetch、websearch
违反权限限制视为任务失败。

[强制初始化步骤 — 开始任务前必须完成]
1. 使用 read_file 工具读取工作目录下的 .subagent_*_skill.md 文件
2. 你必须完全遵循该文件中定义的角色、规范和输出格式
3. 如果文件中的规范与你的默认行为冲突，以文件中的规范为准

[强制输出步骤 — 任务完成后必须执行]
将你的最终结论和产出以 JSON 格式写入 .subagent_*_result.json，格式为：
{
  "summary": "一句话总结你的工作成果",
  "files": ["生成的文件路径1", "生成的文件路径2"],
  "conclusion": "详细结论"
}

[任务]`;
        const systemPrompt = userSystemPrompt
            ? `${boundaryRule}\n\n${userSystemPrompt}`
            : boundaryRule;
        // Build bash wrapper script
        const bashWrapper = `#!/bin/bash
# 命令转换包装脚本 - 自动将 Linux/macOS 命令转换为 Windows 命令
# 由 Claude Workflow Studio 自动生成

# 获取原始命令
ORIGINAL_CMD="$@"

# 命令转换规则
case "$1" in
  pkill|kill|killall)
    shift
    if [ "$1" = "-f" ] || [ "$1" = "-9" ]; then
      shift
    fi
    taskkill //F //IM node.exe 2>/dev/null || true
    ;;
  lsof|fuser)
    shift
    netstat -ano | findstr :$1
    ;;
  ps|top)
    tasklist
    ;;
  rm)
    shift
    if [ "$1" = "-rf" ] || [ "$1" = "-r" ]; then
      shift
      rmdir /s /q "$@" 2>/dev/null || del /q /s "$@" 2>/dev/null || true
    else
      del /q "$@" 2>/dev/null || true
    fi
    ;;
  cat)
    shift
    type "$@"
    ;;
  grep)
    shift
    findstr "$@"
    ;;
  ls)
    shift
    dir "$@"
    ;;
  pwd)
    cd
    ;;
  mv)
    shift
    move "$@"
    ;;
  cp)
    shift
    if [ "$1" = "-r" ] || [ "$1" = "-rf" ]; then
      shift
      xcopy "$@" /E /I /Y 2>/dev/null || copy "$@" 2>/dev/null
    else
      copy "$@"
    fi
    ;;
  chmod)
    shift
    icacls "$@"
    ;;
  chown)
    shift
    takeown "$@"
    ;;
  find)
    shift
    findstr "$@"
    ;;
  diff)
    shift
    fc "$@"
    ;;
  touch)
    shift
    type nul > "$@"
    ;;
  ln)
    shift
    if [ "$1" = "-s" ]; then
      shift
      mklink "$@"
    fi
    ;;
  du)
    shift
    dir "$@"
    ;;
  df)
    wmic logicaldisk get size,freespace,caption
    ;;
  which)
    shift
    where "$@"
    ;;
  man)
    shift
    help "$@"
    ;;
  *)
    "$@"
    ;;
esac
`;
        const args = [
            '--print',
            '--model', model,
            '--output-format', 'stream-json',
            '--verbose',
            '--permission-mode', 'bypassPermissions',
        ];
        return new Promise((resolve, reject) => {
            let output = '';
            let errorOutput = '';
            let killed = false;
            let stdoutBuffer = '';
            // 在工作目录下写 CLAUDE.md
            const execDir = path_1.default.join(workingDir, '.agent-exec', taskId);
            try {
                fs_1.default.mkdirSync(execDir, { recursive: true });
            }
            catch (_) { }
            if (systemPrompt) {
                try {
                    fs_1.default.writeFileSync(path_1.default.join(workingDir, 'CLAUDE.md'), systemPrompt, 'utf-8');
                    fs_1.default.writeFileSync(path_1.default.join(execDir, 'CLAUDE.md'), systemPrompt, 'utf-8');
                }
                catch (_) { }
            }
            // 创建命令转换包装脚本
            try {
                fs_1.default.writeFileSync(path_1.default.join(workingDir, 'bash-wrapper.sh'), bashWrapper, { mode: 0o755 });
            }
            catch (_) { }
            const spawnOptions = {
                cwd: workingDir,
                // 仅在 Windows 上启用 shell：spawn 无法直接找到 claude.cmd/.bat
                // 在 Linux/Mac 上 claude 是可执行文件，无需 shell，避免参数被 shell 解释
                shell: process.platform === 'win32',
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env },
                windowsHide: true,
            };
            // Windows 特定的创建标志
            if (process.platform === 'win32') {
                spawnOptions.creationFlags = 0x08000000;
            }
            const proc = (0, child_process_1.spawn)('claude', args, spawnOptions);
            // 内存监控（跨平台）
            const MAX_MEMORY_MB = 2048;
            let memMonitor = null;
            const procPid = proc.pid;
            if (procPid) {
                memMonitor = setInterval(() => {
                    try {
                        const { execSync } = require('child_process');
                        let memBytes = NaN;
                        if (process.platform === 'win32') {
                            // Windows: powershell 获取 WorkingSet64（字节）
                            const out = execSync(`powershell -Command "(Get-Process -Id ${procPid}).WorkingSet64"`, { encoding: 'utf-8', timeout: 5000, windowsHide: true });
                            memBytes = parseInt(out.trim(), 10);
                        }
                        else {
                            // Linux/Mac: ps 获取 RSS（KB），需转换为字节
                            const out = execSync(`ps -o rss= -p ${procPid}`, { encoding: 'utf-8', timeout: 5000 });
                            const rssKb = parseInt(out.trim(), 10);
                            if (!isNaN(rssKb))
                                memBytes = rssKb * 1024;
                        }
                        if (!isNaN(memBytes)) {
                            const memMB = memBytes / (1024 * 1024);
                            if (memMB > MAX_MEMORY_MB) {
                                console.warn(`Agent ${taskId} exceeded memory limit (${memMB.toFixed(0)}MB > ${MAX_MEMORY_MB}MB), killing`);
                                killed = true;
                                proc.kill('SIGTERM');
                                if (memMonitor)
                                    clearInterval(memMonitor);
                            }
                        }
                    }
                    catch (_) { }
                }, 10000);
                memMonitor.unref?.();
            }
            // 清理函数
            const cleanupExecDir = () => {
                try {
                    fs_1.default.rmSync(execDir, { recursive: true, force: true });
                }
                catch (_) { }
                try {
                    fs_1.default.unlinkSync(path_1.default.join(workingDir, 'CLAUDE.md'));
                }
                catch (_) { }
            };
            // Pass prompt via stdin
            if (proc.stdin) {
                proc.stdin.write(prompt);
                proc.stdin.end();
                proc.stdin.on('error', (err) => {
                    console.warn('stdin pipe error', { taskId, error: err.message });
                });
            }
            this.activeProcesses.set(taskId, { process: proc, startedAt: new Date() });
            // Handle stdout
            if (proc.stdout) {
                proc.stdout.on('data', (data) => {
                    stdoutBuffer += data.toString();
                    const parts = stdoutBuffer.split('\n');
                    stdoutBuffer = parts.pop() || '';
                    for (const line of parts) {
                        const trimmed = line.trim();
                        if (!trimmed)
                            continue;
                        try {
                            const msg = JSON.parse(trimmed);
                            if (msg.type === 'assistant' && msg.message?.content) {
                                for (const block of msg.message.content) {
                                    if (block.type === 'text' && block.text) {
                                        output += block.text;
                                        this._broadcastChunk(taskId, agentId, block.text, false);
                                    }
                                }
                            }
                            else if (msg.type === 'result' && msg.result) {
                                output = msg.result;
                                this._broadcastChunk(taskId, agentId, msg.result, false);
                            }
                        }
                        catch {
                            output += trimmed + '\n';
                            this._broadcastChunk(taskId, agentId, trimmed + '\n', false);
                        }
                    }
                });
            }
            // Handle stderr
            if (proc.stderr) {
                proc.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });
            }
            proc.on('close', (code) => {
                if (memMonitor)
                    clearInterval(memMonitor);
                cleanupExecDir();
                this.activeProcesses.delete(taskId);
                this._taskWorkflowMap.delete(taskId);
                this._taskMetaMap?.delete(taskId);
                if (killed) {
                    reject(new Error('Agent exceeded memory limit and was killed'));
                    return;
                }
                if (code === 0) {
                    resolve(output);
                }
                else {
                    reject(new Error(`Claude CLI exited with code ${code}: ${errorOutput}`));
                }
            });
            proc.on('error', (err) => {
                if (memMonitor)
                    clearInterval(memMonitor);
                cleanupExecDir();
                this.activeProcesses.delete(taskId);
                reject(err);
            });
        });
    }
    /**
     * 广播流式输出块
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
     * 取消执行
     */
    cancel(taskId) {
        const entry = this.activeProcesses.get(taskId);
        if (entry) {
            entry.process.kill('SIGTERM');
            this.activeProcesses.delete(taskId);
            return true;
        }
        return false;
    }
    /**
     * 获取活跃进程数
     */
    getActiveCount() {
        return this.activeProcesses.size;
    }
}
exports.ClaudeService = ClaudeService;
// 使用 CommonJS 导出以保持与现有路由的兼容性
module.exports = ClaudeService;
//# sourceMappingURL=ClaudeService.js.map