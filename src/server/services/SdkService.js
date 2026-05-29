const { Anthropic } = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { AppError } = require('../middleware/errorHandler');
const ApiKeyService = require('./ApiKeyService');
const logger = require('../utils/logger');

/**
 * SDK-based Claude execution engine
 * 使用 Anthropic SDK 替代 CLI spawn，实现真正的多 Agent 协作
 */
class SdkService {
  constructor(broadcastService) {
    this.broadcastService = broadcastService;
    this.activeStreams = new Map();   // taskId -> { abortController, ... }
    this._taskWorkflowMap = new Map(); // taskId -> workflowId
    this._taskMetaMap = new Map();    // taskId -> { runId, nodeId }
    this._pendingApprovals = new Map(); // approvalRequestId -> { resolve, timer }
    this._maxAgentDepth = 3; // Max nesting depth for Agent tool delegation
    this._agentCallIndex = 0; // Track Agent tool calls for checkpoint mapping
    this._executableNodes = []; // Ordered list of workflow executable nodes
    this._checkpointCallback = null; // Called after each Agent call completes
    this._nodeRegistry = {}; // nodeId -> { label, model, systemPrompt, task, skills, mcp }
  }

  /**
   * Get file snapshot (same as ClaudeService for compatibility)
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
   * Execute via Anthropic SDK — streaming mode with Agent tool support
   */
  async execute(taskId, agentId, prompt, config = {}) {
    const { circuits } = require('../utils/CircuitBreaker');
    const cb = circuits.default;
    return cb.call(async () => this._executeInternal(taskId, agentId, prompt, config));
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
    const workingDir = config.folderPath || config.workingDir || process.cwd();
    const timeoutMs = config.timeoutMs || 30 * 60 * 1000;

    // Get client config from default API Key config
    let clientConfig;
    try {
      clientConfig = ApiKeyService.getClientConfig();
    } catch (e) {
      throw new AppError('API_KEY_MISSING', e.message, 400);
    }
    const model = clientConfig.model || modelAlias;

    // Build Anthropic client (all providers use Anthropic Messages API format)
    // Temporarily clear ANTHROPIC_AUTH_TOKEN to prevent SDK from using env var instead of configured key
    const savedAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;

    const clientOpts = { apiKey: clientConfig.apiKey };
    if (clientConfig.baseUrl) {
      clientOpts.baseURL = clientConfig.baseUrl.replace(/\/+$/, '');
    }
    const client = new Anthropic(clientOpts);

    // Restore env vars after client creation
    if (savedAuthToken) process.env.ANTHROPIC_AUTH_TOKEN = savedAuthToken;

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

    return new Promise((resolve, reject) => {
      // Use the SDK's streaming API
      this._runAgentLoop(client, model, systemPrompt, prompt, tools, taskId, agentId, workingDir, timeoutMs, abortSignal)
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
   * Multi-turn agent loop with tool calling support
   * Implements the Agent tool for sub-agent delegation
   */
  async _runAgentLoop(client, model, systemPrompt, userPrompt, tools, taskId, agentId, workingDir, timeoutMs, abortSignal) {
    const messages = [{ role: 'user', content: userPrompt }];
    let fullText = '';
    const startTime = Date.now();

    // Track background agent tasks
    const backgroundTasks = [];

    while (true) {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        return { error: { type: 'TIMEOUT', message: 'SDK execution timed out (30 minutes)' } };
      }
      if (abortSignal?.aborted) {
        const reason = abortSignal.reason || 'CANCELLED';
        return { error: { type: reason, message: reason === 'PAUSED' ? 'Execution paused' : 'Execution cancelled' } };
      }

      try {
        const response = await client.messages.create({
          model,
          system: [{ type: 'text', text: systemPrompt }],
          messages,
          tools,
          max_tokens: 16000,
        });

        const stopReason = response.stop_reason;
        const content = response.content;

        // Collect text output
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            fullText += block.text;
            this._broadcastChunk(taskId, agentId, block.text, false);
          }
        }

        if (stopReason === 'end_turn') {
          break;
        }

        if (stopReason === 'tool_use') {
          const toolResults = [];

          for (const block of content) {
            if (block.type !== 'tool_use') continue;

            const toolResult = await this._handleToolCall(
              block, client, taskId, workingDir, tools, backgroundTasks, 0
            );
            toolResults.push(toolResult);

            // Save checkpoint immediately after each named Agent call completes
            // Use node ID from tool name (Agent_n2 -> n2) instead of sequential index
            // to avoid misalignment if model skips or reorders tool calls
            if (block.name.startsWith('Agent_') && this._checkpointCallback) {
              const nodeId = block.name.substring(6); // Extract node ID from "Agent_nX"
              const nodeInfo = this._nodeRegistry[nodeId];
              if (nodeInfo) {
                this._checkpointCallback(nodeId, nodeInfo.label || nodeId, toolResult.content || '');
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

      } catch (err) {
        logger.error(`SDK API error: ${err.message}`, { status: err.status, code: err.code });
        return { error: { type: this._classifySdkError(err).type, message: err.message, raw: err } };
      }
    }

    // Wait for background tasks to complete
    if (backgroundTasks.length > 0) {
      const bgResults = await Promise.allSettled(backgroundTasks.map(t => t.promise));
      for (let i = 0; i < bgResults.length; i++) {
        const result = bgResults[i];
        const task = backgroundTasks[i];
        if (result.status === 'fulfilled') {
          fullText += `\n\n[后台子Agent "${task.description}" 完成]\n${result.value.substring(0, 2000)}`;
          this._broadcastChunk(taskId, agentId, `\n[后台子Agent "${task.description}" 完成]\n`, false);
        } else {
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
    // 使用 CLI spawn 获得完整工具集、独立进程、独立上下文窗口
    if (toolName.startsWith('Agent_')) {
      const nodeId = toolName.substring(6);
      const nodeInfo = this._nodeRegistry[nodeId];

      if (!nodeInfo) {
        return { type: 'tool_result', tool_use_id: toolId, content: `未知的子Agent: ${toolName}。可用: ${Object.keys(this._nodeRegistry).map(id => 'Agent_' + id).join(', ')}` };
      }

      const subTask = toolInput.task || nodeInfo.task || '执行分配的任务';
      const subModel = nodeInfo.model || 'sonnet';
      const subSystemPrompt = nodeInfo.systemPrompt || nodeInfo.rolePrompt || '';
      const runInBackground = toolInput.run_in_background === true;

      // System prompt: role + skills + MCP + sandbox rules
      let cliSystemPrompt = subSystemPrompt || `你是一个专业的 ${nodeInfo.label || '执行者'}。`;
      if ((nodeInfo.skills || []).length > 0) {
        cliSystemPrompt += `\n\n[可用技能]\n${nodeInfo.skills.join('\n')}`;
      }
      if ((nodeInfo.mcp || []).length > 0) {
        cliSystemPrompt += `\n\n[外部工具]\n${nodeInfo.mcp.join('\n')}`;
      }

      const meta = this._taskMetaMap.get(taskId) || {};
      const subCallId = `${taskId}_${nodeId}_${Date.now()}`;

      if (runInBackground) {
        // 并行节点：启动 CLI 进程后不等待，merge 节点读取工作区文件获取结果
        const bgPromise = this._spawnCliAgent(subCallId, nodeId, nodeInfo, subTask, subModel, cliSystemPrompt, workingDir, meta);
        backgroundTasks.push({ description: nodeInfo.label, promise: bgPromise });
        return { type: 'tool_result', tool_use_id: toolId, content: `后台子Agent "${nodeInfo.label}" 已启动 (model: ${subModel})。输出将保存到工作区文件。` };
      }

      this._broadcastChunk(taskId, null, `\n[启动: ${nodeInfo.label} (${subModel})]\n`, false);
      const subResult = await this._spawnCliAgent(subCallId, nodeId, nodeInfo, subTask, subModel, cliSystemPrompt, workingDir, meta);
      this._broadcastChunk(taskId, null, `\n[完成: ${nodeInfo.label}]\n`, false);
      return { type: 'tool_result', tool_use_id: toolId, content: subResult.substring(0, 16000) };
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
          content: subResult.substring(0, 16000) // Truncate to fit context
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
          this.broadcastService.broadcast('workflow.approvalRequested', {
            workflowId,
            runId: meta.runId || null,
            nodeId: meta.nodeId || null,
            approvalRequestId,
            title: approvalTitle,
            description: approvalDesc,
            context: approvalContent,
            timeout: 3600,
            timestamp: new Date().toISOString()
          });
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
        } else {
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
          const content = fs.readFileSync(filePath, 'utf-8');
          const offset = toolInput.offset || 0;
          const limit = toolInput.limit || content.length;
          const sliced = content.slice(offset, offset + limit);
          return { type: 'tool_result', tool_use_id: toolId, content: sliced };
        } catch (e) {
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
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(filePath, toolInput.content || '', 'utf-8');
          return { type: 'tool_result', tool_use_id: toolId, content: `File written: ${path.relative(workingDir, filePath)}` };
        } catch (e) {
          return { type: 'tool_result', tool_use_id: toolId, content: `Error writing file: ${e.message}` };
        }
      }

      case 'list_files': {
        try {
          const dir = path.resolve(workingDir, toolInput.path || '.');
          if (!dir.startsWith(workingDir)) {
            return { type: 'tool_result', tool_use_id: toolId, content: 'Error: Path outside workspace' };
          }
          const files = fs.readdirSync(dir, { withFileTypes: true });
          const listing = files.map(f => `${f.isDirectory() ? '[DIR]' : '[FILE]'} ${f.name}`).join('\n');
          return { type: 'tool_result', tool_use_id: toolId, content: listing || '(empty directory)' };
        } catch (e) {
          return { type: 'tool_result', tool_use_id: toolId, content: `Error listing files: ${e.message}` };
        }
      }

      case 'execute_command':
      case 'bash': {
        try {
          const { execSync } = require('child_process');
          const cmd = toolInput.command || toolInput.cmd || '';
          if (!cmd) return { type: 'tool_result', tool_use_id: toolId, content: 'Error: No command provided' };
          const cwd = toolInput.working_dir ? path.resolve(workingDir, toolInput.working_dir) : workingDir;
          if (!cwd.startsWith(workingDir)) {
            return { type: 'tool_result', tool_use_id: toolId, content: 'Error: Working directory outside workspace' };
          }
          const result = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 60000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
          return { type: 'tool_result', tool_use_id: toolId, content: result || '(command executed successfully)' };
        } catch (e) {
          return { type: 'tool_result', tool_use_id: toolId, content: `Command error (code ${e.status}): ${e.stderr || e.message}` };
        }
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
   * Spawn a CLI sub-agent via ClaudeService — full toolset, isolated process, independent context
   */
  async _spawnCliAgent(callId, nodeId, nodeInfo, task, model, systemPrompt, workingDir, meta) {
    const claudeService = global.__claudeService;
    if (claudeService) {
      const parentTaskId = callId.replace(/_[^_]+_[^_]+$/, '');

      // Write skill guide to working directory for sub-agent to read
      const resultFile = `.subagent_${nodeId}_result.json`;
      const skillFile = `.subagent_${nodeId}_skill.md`;
      try {
        const fs = require('fs');
        fs.writeFileSync(path.join(workingDir, skillFile), systemPrompt, 'utf-8');
      } catch (_) {}

      // Build constrained prompt: hard rules + result file mechanism
      const perms = nodeInfo.toolPermissions || {};
      let permBlock = '';
      if (perms.executeCommand === false || perms.browser === false || perms.search === false) {
        const denied = [], allowed = [];
        if (perms.executeCommand === false) denied.push('执行命令/Bash'); else allowed.push('执行命令');
        if (perms.browser === false) denied.push('浏览器操作'); else allowed.push('浏览器');
        if (perms.search === false) denied.push('搜索/WebSearch'); else allowed.push('搜索');
        permBlock = '\n[工具权限限制 — 必须严格遵守]\n';
        if (denied.length > 0) permBlock += '✗ 禁止: ' + denied.join('、') + '\n';
        if (allowed.length > 0) permBlock += '✓ 允许: ' + allowed.join('、') + '\n';
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
          if (summary) output = `[摘要] ${summary}\n\n${output}`;
          if (files.length > 0) output += `\n\n[生成文件]\n${files.map(f => `- ${f}`).join('\n')}`;
          // Clean up temp files
          try { fs.unlinkSync(resultPath); } catch (_) {}
          try { fs.unlinkSync(path.join(workingDir, skillFile)); } catch (_) {}
          return output;
        }
      } catch (_) {}
      // Clean up temp files even if result.json not found
      try {
        const fs = require('fs');
        fs.unlinkSync(path.join(workingDir, skillFile));
      } catch (_) {}

      return ''; // Fallback — output was streamed via WebSocket
    }

    // CLI not available → fallback to SDK sub-agent
    logger.warn(`CLI not available for sub-agent ${nodeInfo.label}, using SDK fallback`);
    const savedAuthToken2 = process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    const client = new Anthropic(ApiKeyService.getClientConfig());
    if (savedAuthToken2) process.env.ANTHROPIC_AUTH_TOKEN = savedAuthToken2;
    return this._runSubAgent(client, callId, nodeInfo.label, task, model, workingDir, 1);
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
      const response = await client.messages.create({
        model,
        system: [{ type: 'text', text: subSystemPrompt }],
        messages,
        tools: fullTools,
        max_tokens: 16000,
      });

      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          fullText += block.text;
          this._broadcastChunk(parentTaskId, null, block.text, false);
        }
      }

      if (response.stop_reason === 'end_turn') break;

      if (response.stop_reason === 'tool_use') {
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const result = await this._handleToolCall(block, client, parentTaskId, workingDir, fullTools, [], depth);
          toolResults.push(result);
        }
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      messages.push({ role: 'assistant', content: response.content });
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
      const descParts = [
        `执行[${nodeInfo.label}]任务。`,
        `角色: ${nodeInfo.rolePrompt || '专业执行者'}`,
        `使用模型: ${nodeInfo.model || 'sonnet'}`,
      ];
      if (skills.length > 0) descParts.push(`技能: ${skills.join(', ')}`);
      if (mcp.length > 0) descParts.push(`外部工具: ${mcp.join(', ')}`);

      tools.push({
        name: toolName,
        description: descParts.join(' '),
        input_schema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: `具体要执行的${nodeInfo.label}相关任务` },
            run_in_background: { type: 'boolean', description: '是否后台异步执行' }
          },
          required: ['task']
        }
      });
    }

    // Generic Agent tool as fallback
    tools.push({
      name: 'Agent',
      description: '通用子 Agent，用于工作流节点之外的任务委派。优先使用具名的 Agent_xxx 工具。',
      input_schema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: '简短描述子 Agent 要做什么' },
          prompt: { type: 'string', description: '子 Agent 的完整任务提示词' },
          model: { type: 'string', enum: ['opus', 'sonnet', 'haiku'], description: '使用的模型' },
          run_in_background: { type: 'boolean', description: '是否后台异步执行' }
        },
        required: ['description', 'prompt']
      }
    });

    // Standard tools
    tools.push(
      {
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
      },
      {
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
      },
      {
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
      },
      {
        name: 'list_files',
        description: 'List files and directories in the workspace',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path relative to workspace (default: workspace root)' }
          },
          required: []
        }
      },
      {
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
      }
    );

    return tools;
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
    if (!pending) return false;
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

module.exports = SdkService;
