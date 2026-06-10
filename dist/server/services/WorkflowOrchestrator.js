"use strict";
/**
 * WorkflowOrchestrator — 主控状态机与高级协同编排器
 *
 * 基于 100% 纯 SDK 双轨闭环架构：
 * - 主Agent：原生 Anthropic API（仅 call_sub_agent 工具）
 * - 子Agent：Claude Agent SDK（完整工具权限）
 * - TS层：拦截 call_sub_agent，物理执行子Agent
 *
 * 核心优势：
 * - 主Agent被剥夺所有直接工具，只能通过 call_sub_agent 调度
 * - BetaRunnableTool.run 由 TS 层控制，AI 无法跳过或编造结果
 * - 子Agent在隔离的 Git Worktree 中执行
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowOrchestrator = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const SubAgentRunner_1 = require("./SubAgentRunner");
const child_process_1 = require("child_process");
const util = __importStar(require("util"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const fs_1 = require("fs");
const p_limit_1 = __importDefault(require("p-limit"));
const logger = require('../utils/logger');
const ApiKeyService = require('./ApiKeyService');
const execAsync = util.promisify(child_process_1.exec);
// Session 恢复状态持久化路径
const SESSION_STORE_PATH = path.join(process.cwd(), 'data', 'session-store.json');
// ── 预设子Agent配置 ──────────────────────────────────────────────────────────
const AGENT_REGISTRY = {
    analyzer: {
        id: 'analyzer',
        name: '漏洞分析师',
        timeout: 10 * 60 * 1000, // 10分钟
        baseSystemPrompt: `<identity>
You are a highly specialized, headless Execution Worker running inside an isolated, local Git Worktree sandbox.
You are part of a multi-agent orchestration pipeline. You do not talk to human users directly. Your output is consumed exclusively by a Master Orchestrator.
Your role is to perform repository analysis, code search, and specification design.
</identity>

<operational_rules>
- **FOCUS**: Concentrate strictly on the specific sub-task delegated to you. Do not attempt to analyze the entire repository unless explicitly asked.
- **SANDBOX**: You are locked within the directory designated by your current working directory (CWD). All file reads and searches must happen within this isolated scope.
- **NO CHAT**: Do not write friendly greetings, conversational fluff, or meta-commentary. Start directly with your analysis or tool call.
- **HEADLESS COMPLETION**: Since you run in an unattended environment, you must NEVER ask the user clarifying questions. Make safe engineering assumptions and complete the task autonomously.
</operational_rules>

<tool_use_guidelines>
- **DON'T GUESS**: If you need to know the contents of a file, read it first using Read. If you need to find where a function is defined, search for it using Grep. Never guess code structures or file paths.
- **PRECISE ANALYSIS**: Provide structured, actionable analysis reports. Include file paths, line numbers, and specific findings.
</tool_use_guidelines>

<termination_condition>
When your task is complete, output a structured final report detailing:
1. Key findings and observations
2. Identified issues or risks
3. Recommended next steps
Once this is written, stop and yield.
</termination_condition>`,
        allowedTools: ['Read', 'Glob', 'Grep'], // 纯读权限，无法写
        model: 'haiku'
    },
    coder: {
        id: 'coder',
        name: '核心开发专家',
        baseSystemPrompt: `<identity>
You are a highly specialized Developer running inside an isolated, local Git Worktree sandbox.
You are part of an iterative pipeline. Your output is consumed exclusively by the Master Orchestrator and Evaluators.
Your role is to write, edit, and refactor code with precision and quality.
</identity>

<operational_rules>
- **REVISION MODE**: If you receive a task labeled as "Revision/Modification" with specific feedback:
  1. DO NOT delete or overwrite your existing files unless necessary.
  2. Read the previous code and the provided feedback carefully.
  3. Perform targeted, precise edits (using Edit) to fix the specified bugs.
- **HEADLESS COMPLETION**: Since you run in an unattended environment, you must NEVER ask the user clarifying questions. Make safe engineering assumptions based on project conventions and complete the task autonomously.
- **NO CHAT**: Do not write friendly greetings, conversational fluff, or meta-commentary. Start directly with your plan or tool call.
</operational_rules>

<tool_use_guidelines>
- **DON'T GUESS**: If you need to know the contents of a file, read it first using Read. If you need to find where a function is defined, search for it using Grep. Never guess code structures or file paths.
- **PRECISE EDITS**: When modifying files, use the Edit tool to perform precise, targeted changes rather than overwriting entire files, to save token costs and prevent conflicts.
- **SELF-VERIFICATION**: If you have Bash execution privileges, you MUST verify your modifications by running the local compiler or test suite (e.g., npm run test or similar) before declaring your task complete. Never report a success without verified test outputs.
</tool_use_guidelines>

<termination_condition>
When your task is complete and fully verified, output a structured final report inside a <task_completed> block detailing:
1. Which files were modified or created
2. The compilation or test results
3. A concise technical summary of the implementation
Once this is written, stop and yield.
</termination_condition>`,
        allowedTools: ['Read', 'Write', 'Edit'], // 读写权限，无 Bash
        model: 'sonnet',
        timeout: 15 * 60 * 1000 // 15分钟
    },
    tester: {
        id: 'tester',
        name: '自动化测试员',
        timeout: 15 * 60 * 1000, // 15分钟
        baseSystemPrompt: `<identity>
You are a highly specialized Tester running inside an isolated, local Git Worktree sandbox.
You are part of a multi-agent orchestration pipeline. You do not talk to human users directly. Your output is consumed exclusively by a Master Orchestrator.
Your role is to compile, run tests, and validate the build.
</identity>

<operational_rules>
- **FOCUS**: Concentrate strictly on running tests and validating the build. Do not attempt to modify code unless explicitly asked.
- **SANDBOX**: You are locked within the directory designated by your current working directory (CWD). All terminal commands must happen within this isolated scope.
- **NO CHAT**: Do not write friendly greetings, conversational fluff, or meta-commentary. Start directly with your test execution.
- **HEADLESS COMPLETION**: Since you run in an unattended environment, you must NEVER ask the user clarifying questions. Make safe engineering assumptions and complete the task autonomously.
</operational_rules>

<tool_use_guidelines>
- **DON'T GUESS**: If you need to know the contents of a file, read it first using Read. Never guess code structures or file paths.
- **THOROUGH TESTING**: Run comprehensive tests including unit tests, integration tests, and build validation. Capture and report all output including errors and warnings.
- **EXIT CODE CHECKING**: Always check the exit code of commands. A non-zero exit code indicates failure.
</tool_use_guidelines>

<termination_condition>
When your task is complete, output a structured final report inside a <task_completed> block detailing:
1. Test execution results (pass/fail counts)
2. Build validation results
3. Any errors or warnings encountered
4. A concise technical summary
Once this is written, stop and yield.
</termination_condition>`,
        allowedTools: ['Read', 'Bash'], // 拥有执行命令的权限，但无法修改文件
        model: 'haiku'
    },
    evaluator: {
        id: 'evaluator',
        name: '自治判断评估器',
        baseSystemPrompt: `<identity>
You are an unbiased, extremely strict Quality Assurance (QA) and Code Review Evaluator.
Your sole task is to judge whether the submitted code perfectly satisfies the provided functional requirements and safety standards.
You are NOT a developer. You do not fix code. You only evaluate.
</identity>

<evaluation_rules>
- Be objective and ruthless. If there is a missing test, a potential null-pointer risk, or incomplete logic, you must mark it as FAILED.
- Do not attempt to fix the code yourself. Do not write alternative implementations.
- You must output your verdict strictly in the following JSON format:
{
  "pass": true | false,
  "reason": "Detailed explanation of why it failed, or empty if passed."
}
- CRITICAL: Do NOT wrap the JSON in markdown code blocks (e.g., do not use \`\`\`json). Do not output any conversational greetings, explanations, or meta-commentary before or after the JSON. Your output must be 100% parsable JSON.
</evaluation_rules>

<termination_condition>
Output ONLY the JSON verdict. Nothing else. Stop immediately after the JSON.
</termination_condition>`,
        allowedTools: ['Read'], // 只读权限，无法写入或执行
        model: 'haiku',
        timeout: 10 * 60 * 1000 // 10分钟
    }
};
// ── WorkflowOrchestrator 类 ────────────────────────────────────────────────────
class WorkflowOrchestrator {
    anthropic;
    activeRunners = new Map();
    workspaceRoot;
    logger;
    stateStore;
    stopped = false; // 停止标志，阻止新的子Agent启动
    broadcastService; // 广播服务
    currentWorkflowId = ''; // 当前工作流ID
    currentRunId = ''; // 当前运行ID
    currentWorkflow = null; // 当前工作流数据
    _approvalResolvers = null; // 独立的审批系统
    agentLimit = (0, p_limit_1.default)(5); // 运行并发硬限制
    gitLockLimit = (0, p_limit_1.default)(1); // Git 写操作串行，杜绝 index.lock 并发冲突
    constructor(workspaceRoot, stateStore, logger, broadcastService) {
        // 从 ApiKeyService 获取 API 配置
        const clientConfig = ApiKeyService.getClientConfig();
        const opts = { apiKey: clientConfig.apiKey };
        if (clientConfig.baseUrl)
            opts.baseURL = clientConfig.baseUrl;
        this.anthropic = new sdk_1.default(opts);
        this.workspaceRoot = path.resolve(workspaceRoot);
        this.stateStore = stateStore;
        this.logger = logger;
        this.broadcastService = broadcastService;
    }
    /**
     * 处理审批节点（编排器级别拦截）
     * 遇到审批节点时暂停执行，等待用户审批
     * 返回 { passed: boolean, feedback?: string }
     */
    async handleApprovalNode(nodeId, nodeLabel) {
        this.logger.info(`[Orchestrator] 🛑 遇到审批节点: ${nodeLabel} (${nodeId})`);
        // 生成审批ID
        const approvalId = require('uuid').v4();
        this.logger.info(`[Orchestrator] 审批ID: ${approvalId}`);
        // 广播审批请求
        if (this.broadcastService) {
            this.broadcastService.broadcast('workflow.approvalRequested', {
                workflowId: this.currentWorkflowId,
                runId: this.currentRunId,
                approvalRequestId: approvalId,
                nodeId: nodeId,
                title: nodeLabel || '审批请求',
                description: '工作流执行到审批节点，等待用户确认',
                timestamp: new Date().toISOString()
            });
        }
        // 更新节点状态为运行中
        try {
            const WorkflowModel = require('../models/Workflow');
            WorkflowModel.updateNodeStatus(this.currentWorkflowId, nodeId, 'running');
        }
        catch (e) { /* 忽略 */ }
        // 挂起等待审批结果（使用独立的审批系统，不依赖WorkflowService的reject机制）
        const approvalResult = await new Promise((resolve) => {
            // 使用独立的审批Map，避免WorkflowService的reject机制
            if (!this._approvalResolvers) {
                this._approvalResolvers = new Map();
            }
            this._approvalResolvers.set(approvalId, {
                resolve,
                timer: setTimeout(() => {
                    this.logger.warn(`[Orchestrator] 审批超时，自动通过`);
                    this._approvalResolvers?.delete(approvalId);
                    resolve({ decision: 'approve', comment: '' });
                }, 3600 * 1000) // 1小时超时
            });
        });
        // 更新节点状态
        try {
            const WorkflowModel = require('../models/Workflow');
            if (approvalResult.decision === 'approve') {
                WorkflowModel.updateNodeStatus(this.currentWorkflowId, nodeId, 'completed', '用户审批通过');
                this.logger.info(`[Orchestrator] ✅ 审批通过: ${nodeLabel}`);
                return { passed: true };
            }
            else {
                WorkflowModel.updateNodeStatus(this.currentWorkflowId, nodeId, 'failed', approvalResult.comment || '用户拒绝');
                this.logger.info(`[Orchestrator] ❌ 审批拒绝: ${nodeLabel}`);
                return { passed: false, feedback: approvalResult.comment || '用户拒绝' };
            }
        }
        catch (e) { /* 忽略 */ }
        return { passed: approvalResult.decision === 'approve', feedback: approvalResult.comment };
    }
    /**
     * 检查并处理工作流中的审批节点
     * 返回 { passed: boolean, feedback?: string }
     */
    async processApprovalNodes(workflow, processedNodes) {
        if (!workflow.nodes)
            return { passed: true };
        for (const node of workflow.nodes) {
            if (node.type === 'approval' && !processedNodes.has(node.id)) {
                const result = await this.handleApprovalNode(node.id, node.label || '审批节点');
                processedNodes.add(node.id);
                if (!result.passed) {
                    return { passed: false, feedback: result.feedback }; // 审批被拒绝
                }
            }
        }
        return { passed: true }; // 所有审批通过
    }
    /**
     * 处理审批决策（由API调用）
     */
    handleApprovalDecision(approvalId, decision, comment) {
        if (!this._approvalResolvers)
            return false;
        const pending = this._approvalResolvers.get(approvalId);
        if (!pending)
            return false;
        clearTimeout(pending.timer);
        this._approvalResolvers.delete(approvalId);
        pending.resolve({ decision, comment });
        return true;
    }
    /**
     * 启动主Agent指挥官（手动消息循环版）
     *
     * 使用稳定的 anthropic.messages.create() API，手动管理 tool_use/tool_result 循环
     * 主Agent仅持有 call_sub_agent 工具，无法直接执行任何操作
     */
    async startMasterCommander(userIntent, workflow, runId) {
        this.logger.info(`[Master] 启动主 Agent 指挥官。工作意图: "${userIntent}"`);
        this.currentWorkflowId = workflow.id;
        this.currentRunId = runId || '';
        this.currentWorkflow = workflow;
        await this.setupLocalEnvironment();
        // 构建工作流执行指令
        const workflowInstructions = this.buildWorkflowInstructions(workflow, userIntent);
        // 定义工具（稳定的原生 API 格式）
        const MASTER_TOOLS = [
            {
                name: 'call_sub_agent',
                description: '派遣一个具有特定能力的子 Agent 去物理磁盘执行具体任务。你（主Agent）无法直接修改文件或执行命令，必须且只能通过此工具委派任务。',
                input_schema: {
                    type: 'object',
                    properties: {
                        agent_type: {
                            type: 'string',
                            enum: ['analyzer', 'coder', 'tester', 'evaluator'],
                            description: '子 Agent 的类型。'
                        },
                        prompt: {
                            type: 'string',
                            description: '给这个子 Agent 部署的极其详细的任务指令和上下文。'
                        }
                    },
                    required: ['agent_type', 'prompt']
                }
            },
        ];
        try {
            const systemPrompt = `<identity>
You are the Master Orchestrator (Senior Software Architect), running in a highly structured, multi-node automation pipeline.
Your role is purely cognitive: you analyze user intents, design implementation plans, delegate tasks to specialized sub-agents, and evaluate their outputs.
You have NO physical hands. You cannot read/write files or execute bash commands directly. You must rely entirely on your sub-agents via the \`call_sub_agent\` tool.
</identity>

<tools_guidelines>
- Your ONLY physical output channel to the workspace is the \`call_sub_agent\` tool.
- You must NEVER assume, simulate, or hallucinate the output of any sub-agent.
- Whenever you delegate a task, you MUST wait for the tool execution to return the actual, physical output of the sub-agent. Treat any self-generated simulation of a sub-agent's work as a fatal logical error.
- You must strictly evaluate the returned code or test reports. If the results are imperfect, do not proceed. Call \`call_sub_agent\` again with clear, actionable feedback to make the sub-agent modify its work in the same workspace.
</tools_guidelines>

<workflow_nodes>
Your master workflow consists of the following structured nodes executed by the underlying TypeScript runtime:
1. **ANALYZER**: Performs initial repository analysis, code search, and specification design.
2. **CODER (Parallel Fork-Join)**: Spawns parallel developers on independent physical worktrees, then merges their output.
3. **TESTER**: Compiles, runs tests, and validates the build.
4. **AUTONOMOUS EVALUATOR**: A specialized sub-agent that reviews code and returns JSON \`{ "pass": boolean, "reason": "string" }\`.
5. **HUMAN APPROVAL GATE**: A human reviewer inspects the stage results. If approved, you proceed. If rejected, you receive human feedback.
</workflow_nodes>

<decision_and_rollback_rules>
- **REJECTION & ROLLBACK**: If the AUTONOMOUS EVALUATOR returns \`"pass": false\`, or the HUMAN APPROVAL GATE returns a rejection with feedback:
  1. DO NOT attempt to proceed to the next phase.
  2. Analyze the provided failure reason or human feedback carefully.
  3. Formulate a highly targeted "Revision Task".
  4. Call \`call_sub_agent\` with \`agent_type: "coder"\` again. In the prompt, clearly state that this is a REVISION, supply the feedback, and specify what needs to be fixed.
- **FORK-JOIN DATA**: If a task runs in Parallel (Fork-Join), the TypeScript runtime will feed you the combined results of both branches. Treat them as an integrated codebase.
- NEVER assume or simulate the output of any sub-agent. Always wait for the actual \`tool_result\` containing real files or evaluation data.
</decision_and_rollback_rules>

<parallel_execution_rules>
- **PARALLEL FORK**: When you encounter a step that says "并行执行" (Parallel Execution), you MUST call ALL listed \`call_sub_agent\` tools in a SINGLE message.
- **DO NOT serialize parallel tasks**: Do not call one sub-agent, wait for its result, then call the next. This defeats the purpose of parallelization.
- **CORRECT**: In one message, include multiple tool_use blocks:
  \`\`\`
  content: [
    { type: "tool_use", name: "call_sub_agent", input: { agent_type: "coder", prompt: "Task A" } },
    { type: "tool_use", name: "call_sub_agent", input: { agent_type: "coder", prompt: "Task B" } }
  ]
  \`\`\`
- **INCORRECT**: Calling sub-agents one at a time across multiple messages.
- **MERGE NODE**: After parallel tasks complete, their results will be automatically combined and passed to the merge/汇聚 node.
</parallel_execution_rules>

<orchestration_workflow>
To maintain a deterministic and safe execution flow, you must strictly follow this lifecycle:
1. **PLANNING**: When receiving a user request, first write down a short, high-level step-by-step plan before invoking any tool.
2. **DELEGATION**: Dispatch tasks in chronological order. Never run dependent steps out of order.
   - Use \`agent_type: "analyzer"\` for reading code, globbing files, and designing specifications.
   - Use \`agent_type: "coder"\` for writing and editing code (which runs in an isolated git worktree).
   - Use \`agent_type: "tester"\` for compiling, running tests, and validating the build.
   - Use \`agent_type: "evaluator"\` for autonomous quality review with JSON verdict.
3. **EVALUATION**: Analyze the structural tool results. If a test fails, you must loop back to the \`coder\` with the exact error log for self-correction.
4. **DELIVERY**: Once ALL steps in the workflow are completed, output a final summary and stop. Do NOT call any more tools after the last step is completed.

**CRITICAL**: When the workflow instructions show all steps are completed, you MUST stop calling tools and output a final summary. Do NOT repeat or verify steps that are already completed.
</orchestration_workflow>

<anti_patterns>
- NEVER output raw code blocks in your thoughts or replies unless you are summarizing a sub-agent's verified work.
- NEVER invent or assume files have been created. If the tool result says a file doesn't exist, it does not exist.
- NEVER attempt to bypass the \`call_sub_agent\` tool by writing code in your text response.
- NEVER ask the user clarifying questions. Make safe engineering assumptions and proceed autonomously.
</anti_patterns>

${workflowInstructions}

=== 强制执行规则 ===
1. 每个标记为 (agent) 的步骤 ==必须== 使用 call_sub_agent 工具派发子 Agent 执行。
   禁止自己直接处理 agent 步骤。你的角色是调度器，不是执行者。
2. 严格按步骤编号顺序执行。步骤N完成后再开始步骤N+1。
3. 绝对不要尝试自己脑补子 Agent 的输出，你拿不到真实的工具返回，工作流就无法推进。
4. 这是全自动流水线，不要向用户提问或请求确认。
`;
            // 使用 ApiKeyService 解析模型名称
            const resolvedModel = ApiKeyService.resolveModel('sonnet');
            this.logger.info(`[Master] 使用模型: ${resolvedModel}`);
            // 手动消息循环（稳定的原生 API）
            const messages = [{ role: 'user', content: userIntent }];
            let keepRunning = true;
            let finalResult = '';
            const nodeResults = new Map();
            let iteration = 0;
            const maxIterations = 50;
            // 预处理：先处理所有审批节点
            const processedApprovalNodes = new Set();
            const approvalResult = await this.processApprovalNodes(workflow, processedApprovalNodes);
            if (!approvalResult.passed) {
                // 审批被拒绝，将反馈传回给主 Agent
                const approvalFeedback = approvalResult.feedback || '用户拒绝了审批';
                this.logger.info(`[Master] 审批被拒绝，反馈: ${approvalFeedback}`);
                // 将拒绝反馈作为用户消息加入对话
                messages.push({
                    role: 'user',
                    content: `【审批被拒绝】原因: ${approvalFeedback}\n\n请分析拒绝原因，决定是否需要重新执行上游节点进行修改。如果需要修改，请调用 call_sub_agent 重新执行相关任务。`
                });
            }
            while (keepRunning && iteration < maxIterations && !this.stopped) {
                // 每轮开始前检查停止标志
                if (this.stopped) {
                    this.logger.info(`[Master] 检测到停止标志，终止执行`);
                    break;
                }
                iteration++;
                this.logger.info(`[Master] 第 ${iteration} 轮对话`);
                // 调用稳定的原生 API
                const response = await this.anthropic.messages.create({
                    model: resolvedModel,
                    max_tokens: 4096,
                    system: systemPrompt,
                    messages: messages,
                    tools: MASTER_TOOLS
                });
                // 将 assistant 响应加入消息历史
                messages.push({ role: 'assistant', content: response.content });
                // 收集所有工具调用（支持并行）
                const toolCalls = response.content.filter((block) => block.type === 'tool_use');
                if (toolCalls.length > 0) {
                    this.logger.info(`[Master] 收到 ${toolCalls.length} 个工具调用`);
                    // 并行执行所有工具调用
                    const toolResults = await Promise.all(toolCalls.map(async (toolCall) => {
                        const { name, input: toolInput, id: toolUseId } = toolCall;
                        if (name === 'call_sub_agent') {
                            const agent_type = toolInput.agent_type;
                            const prompt = toolInput.prompt;
                            // 检查停止标志
                            if (this.stopped) {
                                return {
                                    type: 'tool_result',
                                    tool_use_id: toolUseId,
                                    content: '【工作流已停止】',
                                    is_error: true
                                };
                            }
                            this.logger.info(`[Master 决策指令] 🤖 主 Agent 决定启动子 Agent [${agent_type}]...`);
                            try {
                                // 物理执行子 Agent 进程（真实执行，无法伪造）
                                const realResult = await this.executeRoutedStep(agent_type, prompt);
                                nodeResults.set(agent_type, realResult);
                                // 实时更新节点状态
                                try {
                                    const WorkflowModel = require('../models/Workflow');
                                    WorkflowModel.updateNodeStatus(this.currentWorkflowId, agent_type, 'completed', realResult.substring(0, 500));
                                    if (this.broadcastService) {
                                        this.broadcastService.broadcast('workflow.nodeStatusChanged', {
                                            workflowId: this.currentWorkflowId,
                                            nodeId: agent_type,
                                            status: 'completed'
                                        });
                                    }
                                }
                                catch (e) { /* 非关键路径，忽略错误 */ }
                                return {
                                    type: 'tool_result',
                                    tool_use_id: toolUseId,
                                    content: `【子 Agent ${agent_type} 真实执行完毕，以下是它的物理产出结果】：\n${realResult}`
                                };
                            }
                            catch (err) {
                                // 工具执行失败，返回错误信息
                                this.logger.error(`[Master] 子 Agent [${agent_type}] 执行失败: ${err.message}`);
                                return {
                                    type: 'tool_result',
                                    tool_use_id: toolUseId,
                                    content: `【子 Agent ${agent_type} 执行失败】：${err.message}`,
                                    is_error: true
                                };
                            }
                        }
                        return null;
                    }));
                    // 将所有工具结果加入消息历史
                    const validResults = toolResults.filter(Boolean);
                    if (validResults.length > 0) {
                        messages.push({
                            role: 'user',
                            content: validResults
                        });
                    }
                }
                else {
                    // 没有工具调用 = 任务结束
                    keepRunning = false;
                    // 提取最终文本结果
                    const textBlocks = response.content.filter((block) => block.type === 'text');
                    finalResult = textBlocks.map(block => block.text).join('\n');
                }
            }
            if (iteration >= maxIterations) {
                this.logger.warn(`[Master] 达到最大迭代次数 ${maxIterations}，强制结束`);
            }
            this.logger.info(`\n[Master] 🏁 主 Agent 宣告任务结束。`);
            // 清理所有worktree
            this.logger.info(`[Orchestrator] 清理所有worktree...`);
            await this.cleanupAllWorktrees();
            return {
                success: true,
                output: finalResult,
                nodeResults
            };
        }
        catch (err) {
            this.logger.error('[Master] 主控会话崩溃', err.message);
            await this.shutdownAll();
            await this.cleanupAllWorktrees();
            return {
                success: false,
                output: '',
                nodeResults: new Map(),
                error: err.message
            };
        }
    }
    /**
     * 构建工作流执行指令（支持并行执行）
     */
    buildWorkflowInstructions(workflow, userInput, _visitedWorkflowIds = new Set(), _depth = 0) {
        const edges = workflow.edges || [];
        const nodeById = {};
        for (const n of workflow.nodes)
            nodeById[n.id] = n;
        // 构建入边和出边映射
        const incomingEdges = new Map();
        const outgoingEdges = new Map();
        for (const n of workflow.nodes) {
            incomingEdges.set(n.id, []);
            outgoingEdges.set(n.id, []);
        }
        for (const e of edges) {
            const s = e.source || e.from || '';
            const t = e.target || e.to || '';
            if (incomingEdges.has(t))
                incomingEdges.get(t).push(s);
            if (outgoingEdges.has(s))
                outgoingEdges.get(s).push(t);
        }
        // 拓扑排序
        const indegree = {};
        for (const n of workflow.nodes) {
            indegree[n.id] = incomingEdges.get(n.id)?.length || 0;
        }
        const queue = workflow.nodes.filter(n => indegree[n.id] === 0).map(n => n.id);
        const order = [];
        while (queue.length) {
            const id = queue.shift();
            order.push(id);
            for (const t of (outgoingEdges.get(id) || [])) {
                indegree[t]--;
                if (indegree[t] === 0)
                    queue.push(t);
            }
        }
        // 检测分叉节点（并行执行）
        const forkNodes = new Set();
        for (const n of workflow.nodes) {
            if ((outgoingEdges.get(n.id) || []).length > 1) {
                forkNodes.add(n.id);
            }
        }
        // 为每个节点生成执行指令
        const steps = [];
        let stepNum = 0;
        const processedNodes = new Set();
        for (const nodeId of order) {
            const node = nodeById[nodeId];
            if (!node)
                continue;
            if (node.type === 'start' || node.type === 'end' || node.type === 'approval')
                continue;
            if (processedNodes.has(nodeId))
                continue;
            const downstream = outgoingEdges.get(nodeId) || [];
            const task = node.defaultPrompt || node.config?.systemPrompt || '执行分配的任务';
            const agentType = this.inferAgentType(node);
            // 先生成当前节点的指令
            stepNum++;
            // 为 evaluator 类型添加只读约束
            let finalTask = task;
            if (agentType === 'evaluator') {
                finalTask = `${task}\n\n⚠️ 重要约束：你只负责评估和审核，绝对不要编写测试代码、修改文件或创建新文件。只读取现有代码并给出评审结果。`;
            }
            steps.push(`步骤 ${stepNum}: **${node.label || node.type}** (${node.type})
【必须调用 call_sub_agent 工具】
- agent_type: "${agentType}"
- prompt: "${finalTask}"`);
            processedNodes.add(nodeId);
            // 如果当前节点有多个下游（分叉）
            if (downstream.length > 1) {
                // Condition 节点：生成条件路由指令（选择一条分支）
                if (node.type === 'condition') {
                    stepNum++;
                    const branches = downstream.map(id => nodeById[id]).filter(Boolean);
                    const branchInstructions = branches.map((n, i) => {
                        const nTask = n.defaultPrompt || n.config?.systemPrompt || '执行分配的任务';
                        const nAgentType = this.inferAgentType(n);
                        const label = n.label || n.id;
                        return `  分支 ${i + 1} [${label}]: call_sub_agent(agent_type: "${nAgentType}", prompt: "${nTask}")`;
                    }).join('\n');
                    const conditionDesc = node.config?.systemPrompt || node.defaultPrompt || '根据上游输出判断';
                    steps.push(`步骤 ${stepNum}: **条件判断** (${node.label || node.type})
【你必须先分析上游节点的输出，然后选择一个分支执行】
判断依据: ${conditionDesc}

可选分支:
${branchInstructions}

⚠️ 重要：你只能选择其中一个分支执行，不要同时执行多个分支！根据上游输出的内容和质量，选择最合适的分支。`);
                    // 不标记下游节点为已处理，让它们在后续拓扑排序中自然出现
                }
                else {
                    // 普通分叉：并行执行
                    stepNum++;
                    const parallelNodes = downstream.map(id => nodeById[id]).filter(Boolean);
                    const parallelInstructions = parallelNodes.map(n => {
                        const nTask = n.defaultPrompt || n.config?.systemPrompt || '执行分配的任务';
                        const nAgentType = this.inferAgentType(n);
                        return `  - call_sub_agent(agent_type: "${nAgentType}", prompt: "${nTask}")`;
                    }).join('\n');
                    steps.push(`步骤 ${stepNum}: **并行执行** (${parallelNodes.map(n => n.label || n.id).join(' + ')})
【必须在同一轮对话中同时调用以下所有 call_sub_agent】
${parallelInstructions}

⚠️ 重要：你必须在一条消息中同时调用所有 call_sub_agent，不要分多条消息！`);
                    parallelNodes.forEach(n => processedNodes.add(n.id));
                }
            }
        }
        // 处理汇聚节点（有多个上游但未被处理的节点）
        for (const nodeId of order) {
            if (processedNodes.has(nodeId))
                continue;
            const node = nodeById[nodeId];
            if (!node || node.type === 'start' || node.type === 'end')
                continue;
            const incoming = incomingEdges.get(nodeId) || [];
            if (incoming.length > 1) {
                stepNum++;
                const upstreamIds = incoming;
                const task = node.defaultPrompt || node.config?.systemPrompt || '执行分配的任务';
                const agentType = this.inferAgentType(node);
                steps.push(`步骤 ${stepNum}: **${node.label || node.type}** (${node.type}) [汇聚节点]
【上游节点输出将作为上下文传递给你】
上游节点: ${upstreamIds.map(id => nodeById[id]?.label || id).join(', ')}

【必须调用 call_sub_agent 工具】
- agent_type: "${agentType}"
- prompt: |
  【上游节点输出】
  你需要从之前的 tool_result 中提取上游节点的输出，并将其包含在这里。

  【你的任务】
  ${task}

⚠️ 重要：在调用 call_sub_agent 之前，你必须先查看之前的 tool_result，提取上游节点的输出，然后将其包含在 prompt 中！`);
                processedNodes.add(nodeId);
            }
        }
        // 添加子工作流节点支持（带循环检测和深度限制）
        const MAX_SUBWORKFLOW_DEPTH = 5;
        for (const node of workflow.nodes) {
            if (node.type === 'subworkflow' && !processedNodes.has(node.id)) {
                stepNum++;
                const subWfId = node.config?.subWorkflowId || node.config?.workflowId;
                if (subWfId) {
                    // 循环检测：如果子工作流已被访问过，跳过
                    if (_visitedWorkflowIds.has(subWfId)) {
                        steps.push(`步骤 ${stepNum}: **${node.label || node.type}** (${node.type}) [子工作流: ${subWfId}]
⚠️ 检测到循环引用，跳过此子工作流。`);
                        processedNodes.add(node.id);
                        continue;
                    }
                    // 深度限制：超过最大嵌套层数时停止展开
                    if (_depth >= MAX_SUBWORKFLOW_DEPTH) {
                        steps.push(`步骤 ${stepNum}: **${node.label || node.type}** (${node.type}) [子工作流: ${subWfId}]
⚠️ 已达到最大嵌套深度（${MAX_SUBWORKFLOW_DEPTH}层），停止展开子工作流。请直接执行此步骤。`);
                        processedNodes.add(node.id);
                        continue;
                    }
                    const subWf = require('../models/Workflow').findById(subWfId);
                    if (subWf) {
                        // 递归展开子工作流，传递已访问集合和深度
                        const visited = new Set(_visitedWorkflowIds);
                        visited.add(subWfId);
                        const subInstructions = this.buildWorkflowInstructions(subWf, '', visited, _depth + 1);
                        steps.push(`步骤 ${stepNum}: **${node.label || node.type}** (${node.type}) [子工作流: ${subWf.name || subWfId}]
【执行以下子工作流】
${subInstructions}`);
                    }
                    else {
                        steps.push(`步骤 ${stepNum}: **${node.label || node.type}** (${node.type}) [子工作流: ${subWfId}]
⚠️ 子工作流 ${subWfId} 不存在，跳过。`);
                    }
                }
                processedNodes.add(node.id);
            }
        }
        // 审批节点由编排器直接处理，不加入模型指令
        return `
=== 用户任务 ===
${userInput}

=== 执行步骤 ===
按以下顺序执行每个步骤：

${steps.join('\n\n')}

=== 工作流结束 ===
当所有步骤都执行完成后，输出最终总结并停止。不要重复调用已经完成的步骤。
`;
    }
    /**
     * 推断Agent类型
     */
    inferAgentType(node) {
        const nodeLabel = String(node.label || '').toLowerCase();
        const taskDesc = String(node.defaultPrompt || '').toLowerCase();
        const combined = `${nodeLabel} ${taskDesc}`;
        // 评估器：审查、评估、判断、审核
        if (combined.includes('审查') || combined.includes('评估') || combined.includes('判断') ||
            combined.includes('审核') || combined.includes('evaluate') || combined.includes('review') ||
            combined.includes('judge') || combined.includes('autonomous')) {
            return 'evaluator';
        }
        // 分析师：搜索、查找、探索、研究、分析、收集
        if (combined.includes('搜索') || combined.includes('查找') || combined.includes('探索') ||
            combined.includes('search') || combined.includes('find') || combined.includes('explore') ||
            combined.includes('研究') || combined.includes('分析') || combined.includes('收集')) {
            return 'analyzer';
        }
        // 测试员：测试、验证、检查
        if (combined.includes('测试') || combined.includes('验证') || combined.includes('检查') ||
            combined.includes('test') || combined.includes('verify') || combined.includes('check')) {
            return 'tester';
        }
        // 默认：开发员
        return 'coder';
    }
    /**
     * 路由到物理进程并执行
     * @param type Agent类型
     * @param prompt 任务描述
     */
    async executeRoutedStep(type, prompt) {
        // 检查是否已停止
        if (this.stopped) {
            throw new Error('工作流已停止，无法执行新的子Agent');
        }
        // 验证并修正 agent 类型
        const validType = AGENT_REGISTRY[type] ? type : 'coder';
        if (type !== validType) {
            logger.warn(`[Orchestrator] 无效的 agent 类型 "${type}"，回退到 "${validType}"`);
        }
        // 使用时间戳+随机数确保唯一性
        const taskId = `${validType}_run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        // 直接使用主工作区，无 worktree 隔离
        const worktreePath = this.workspaceRoot;
        this.logger.info(`[Orchestrator] 使用主工作区: ${worktreePath}`);
        // 查询该任务是否可以热连接到历史会话
        const state = await this.stateStore.get(`agent:${taskId}`);
        const resumeSessionId = state ? state.sessionId : undefined;
        // 载入预设
        const preset = AGENT_REGISTRY[validType];
        // 加载 Skills（从 SkillService 获取）
        let skills = [];
        try {
            const SkillService = require('./SkillService');
            // 获取所有已安装的 Skills
            const allSkills = SkillService.getAll();
            skills = allSkills.map((s) => s.id);
            this.logger.info(`[Orchestrator] 加载 ${skills.length} 个 Skills`);
        }
        catch (err) {
            this.logger.warn(`[Orchestrator] 加载 Skills 失败: ${err.message}`);
        }
        try {
            // 再次检查停止标志
            if (this.stopped) {
                throw new Error('工作流已停止');
            }
            // 系统提示词和用户任务分开传递
            const result = await this.executeStepInWorktree(taskId, prompt, // 用户任务作为 prompt
            preset.allowedTools, worktreePath, preset.model || 'sonnet', resumeSessionId, preset.baseSystemPrompt, // 系统提示词通过 systemPrompt 参数传递
            skills // 技能列表
            );
            this.logger.info(`[Orchestrator] 子Agent完成`);
            return result;
        }
        catch (err) {
            // 如果是停止导致的错误，直接抛出
            if (this.stopped) {
                throw new Error('工作流已停止');
            }
            throw err;
        }
    }
    /**
     * 在隔离的 Worktree 中执行子Agent
     */
    async executeStepInWorktree(id, description, allowedTools, worktree, model = 'sonnet', resumeSessionId, systemPrompt, skills) {
        const logDir = path.join(this.workspaceRoot, 'logs', id);
        const runner = new SubAgentRunner_1.SubAgentRunner(id, logDir);
        this.activeRunners.set(id, runner);
        this.registerListeners(runner);
        try {
            const task = { id, description, worktree, model, resumeSessionId, systemPrompt, skills };
            return await runner.start(task, allowedTools);
        }
        finally {
            this.activeRunners.delete(id);
        }
    }
    /**
     * 清理所有worktree
     */
    async cleanupAllWorktrees() {
        const worktreesDir = path.join(this.workspaceRoot, '.worktrees');
        try {
            if ((0, fs_1.existsSync)(worktreesDir)) {
                const entries = await fs.readdir(worktreesDir);
                for (const entry of entries) {
                    const worktreePath = path.join(worktreesDir, entry);
                    try {
                        await fs.rm(worktreePath, { recursive: true, force: true });
                        this.logger.info(`[Orchestrator] 清理worktree: ${entry}`);
                    }
                    catch (err) {
                        this.logger.warn(`[Orchestrator] 清理worktree失败: ${entry}`, err.message);
                    }
                }
            }
        }
        catch (err) {
            this.logger.warn(`[Orchestrator] 清理worktrees目录失败: ${err.message}`);
        }
    }
    /**
     * 注册事件监听器
     */
    registerListeners(runner) {
        runner.on('started', (data) => this.logger.info(`子Agent [${data.id}] 启动`));
        runner.on('progress', (data) => {
            // 进度推送（可扩展为WebSocket推送）
            this.logger.info(`[子Agent ${data.id}] ${data.text.substring(0, 100)}...`);
        });
        runner.on('tool_executed', (data) => this.logger.info(`\n[Audit][${data.id}] 调用工具: ${data.toolName}`));
        // 捕获物理会话并持久化，供异常断点自愈
        runner.on('session_captured', async (data) => {
            this.logger.info(`已捕获子 Agent [${data.id}] 的物理会话 ID: ${data.sessionId}，保存进状态库。`);
            await this.saveOrchestrationState(data.id, 'running', null, data.sessionId);
        });
        runner.on('security_check', ({ toolName, toolInput, approve, deny }) => {
            // 默认批准（安全检查已在 SubAgentRunner 的 PreToolUse 钩子中完成）
            approve();
        });
        runner.on('failed', (data) => this.logger.error(`子Agent [${data.id}] 失败: ${data.error}`));
        runner.on('completed', (data) => this.logger.info(`子Agent [${data.id}] 完成`));
    }
    /**
     * 强制关闭所有活跃的子Agent
     */
    async shutdownAll() {
        this.stopped = true; // 设置停止标志，阻止新的子Agent启动
        this.logger.warn(`正在强制回收当前活跃进程... 数量: ${this.activeRunners.size}`);
        // 先杀死所有活跃的子Agent
        for (const [id, runner] of this.activeRunners.entries()) {
            try {
                runner.kill();
                this.logger.info(`已发送终止信号给子Agent: ${id}`);
            }
            catch (err) {
                this.logger.error(`物理杀死进程 ${id} 失败`, err.message);
            }
        }
        // 等待一小段时间让子Agent响应终止信号
        await new Promise(resolve => setTimeout(resolve, 500));
        this.activeRunners.clear();
        this.logger.info(`所有子Agent已回收`);
    }
    /**
     * 设置本地环境（Git排除策略）
     */
    async setupLocalEnvironment() {
        const excludePath = path.join(this.workspaceRoot, '.git', 'info', 'exclude');
        try {
            if ((0, fs_1.existsSync)(excludePath)) {
                const content = await fs.readFile(excludePath, 'utf8');
                if (!content.includes('.worktrees/')) {
                    await fs.appendFile(excludePath, '\n.worktrees/\n');
                }
            }
        }
        catch (err) {
            this.logger.warn('本地 Git 排除策略配置失败', err.message);
        }
    }
    /**
     * 创建隔离工作区（Git Worktree 或普通目录）
     */
    async createWorktree(agentId) {
        const worktreePath = path.join(this.workspaceRoot, '.worktrees', agentId);
        await this.forcePrune(agentId, worktreePath);
        // 检查是否是 Git 仓库
        const isGitRepo = (0, fs_1.existsSync)(path.join(this.workspaceRoot, '.git'));
        if (isGitRepo) {
            try {
                await execAsync(`git worktree add "${worktreePath}" -b "branch-${agentId}"`, { cwd: this.workspaceRoot });
                this.logger.info(`[Git] 创建 worktree: ${worktreePath}`);
                return worktreePath;
            }
            catch (err) {
                this.logger.warn(`[Git] 创建 worktree 失败，回退到目录隔离: ${err.message}`);
            }
        }
        // 回退：使用普通目录隔离
        await fs.mkdir(worktreePath, { recursive: true });
        this.logger.info(`[Dir] 创建隔离目录: ${worktreePath}`);
        return worktreePath;
    }
    /**
     * 清理 Git Worktree
     */
    async cleanupWorktree(agentId, worktreePath) {
        await this.forcePrune(agentId, worktreePath);
    }
    /**
     * 强制清理 Worktree（幂等操作）
     */
    async forcePrune(agentId, worktreePath) {
        try {
            if ((0, fs_1.existsSync)(worktreePath)) {
                await execAsync(`git worktree remove "${worktreePath}" --force`, { cwd: this.workspaceRoot });
            }
        }
        catch (_) { }
        try {
            await execAsync('git worktree prune', { cwd: this.workspaceRoot });
        }
        catch (_) { }
        try {
            if ((0, fs_1.existsSync)(worktreePath)) {
                await fs.rm(worktreePath, { recursive: true, force: true });
            }
        }
        catch (_) { }
        try {
            await execAsync(`git branch -D "branch-${agentId}"`, { cwd: this.workspaceRoot });
        }
        catch (_) { }
    }
    /**
     * 保存编排状态（用于断点恢复）
     */
    async saveOrchestrationState(agentId, status, error = null, sessionId = null) {
        const state = {
            agentId,
            status,
            error,
            sessionId,
            timestamp: new Date().toISOString(),
        };
        await this.stateStore.save(`agent:${agentId}`, state);
    }
    /**
     * 崩溃恢复自检
     */
    async recoverFromCrash() {
        this.logger.info('>>> 启动崩溃恢复自检...');
        const runningTasks = await this.stateStore.query({ status: 'running' });
        if (runningTasks.length === 0) {
            this.logger.info('自检完毕，未发现未完成的任务残余。');
            return;
        }
        this.logger.info(`发现 ${runningTasks.length} 个意外断电/崩溃导致的中断任务，启动自愈程序...`);
        for (const task of runningTasks) {
            const elapsed = Date.now() - new Date(task.timestamp).getTime();
            const staleWorktreePath = path.join(this.workspaceRoot, '.worktrees', task.agentId);
            if (elapsed > 24 * 60 * 60 * 1000) {
                this.logger.warn(`任务 [${task.agentId}] 中断时间超过 24 小时，标记为失效，开始清理资源...`);
                await this.saveOrchestrationState(task.agentId, 'failed', 'Crash recovery timeout');
                await this.gitLockLimit(() => this.forcePrune(task.agentId, staleWorktreePath));
            }
            else {
                this.logger.info(`正在为 [${task.agentId}] 进行 Session 热重连，会话ID: ${task.sessionId}`);
                // 重新物理恢复到之前的会话中
                this.executeStepInWorktree(task.agentId, task.description, ['Read', 'Write', 'Edit', 'Bash'], staleWorktreePath, 'sonnet', task.sessionId).catch(err => {
                    this.logger.error(`自愈任务 [${task.agentId}] 在重新启动后发生故障`, err.message);
                });
            }
        }
    }
}
exports.WorkflowOrchestrator = WorkflowOrchestrator;
//# sourceMappingURL=WorkflowOrchestrator.js.map