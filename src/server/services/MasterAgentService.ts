/**
 * MasterAgentService — 将所有工作流转换为 Claude Code 原生多 Agent 协作模式
 *
 * 无论节点类型，均用一个主 claude 进程 + Agent 工具 / 原生能力实现，
 * 子 Agent 共享同一工作区，文件互见。
 *
 */

// JS 模块使用 require 导入（尚未转换为 TS）
const AgentModel = require('../models/Agent');
const logger = require('../utils/logger');

// 类型定义
export interface WorkflowNode {
  id: string;
  type: string;
  label?: string;
  agentId?: string;
  agentType?: string;
  defaultPrompt?: string;
  config?: {
    model?: string;
    systemPrompt?: string;
    agentType?: string;
    pattern?: string;
    condition?: string;
    trueLabel?: string;
    falseLabel?: string;
    subWorkflowId?: string;
    workflowId?: string;
    approvalTitle?: string;
    approvalDescription?: string;
  };
  skillNames?: string[];
  status?: string;
  output?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowEdge {
  id?: string;
  source?: string;
  from?: string;
  target?: string;
  to?: string;
  label?: string;
}

export interface Workflow {
  id: string;
  name?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  folderPath?: string;
  context?: Record<string, any>;
  memoryEnabled?: boolean;  // 是否启用记忆注入（默认false）
  memorySource?: {
    type: string;
    workflowId?: string;
  };
  knowledgeSource?: {
    type: string;
    entryIds?: string[];
    category?: string;
  };
}

export interface CheckpointData {
  completedNodes?: Record<string, { status: string; output?: string }>;
}

export interface AgentTypeConfig {
  name: string;
  description: string;
}

export class MasterAgentService {
  static canUseMasterAgent(workflow: Workflow | null): boolean {
    if (!workflow || !workflow.nodes || workflow.nodes.length === 0) return false;
    return true;
  }

  static buildSystemPrompt(
    workflow: Workflow,
    userInput: string,
    workingDir: string,
    checkpointData?: CheckpointData | null
  ): string {
    try {
    logger.info('buildSystemPrompt called', { workflowId: workflow.id, nodeCount: workflow.nodes?.length });
    const edges = workflow.edges || [];
    const nodeById: Record<string, WorkflowNode> = {};
    for (const n of workflow.nodes) nodeById[n.id] = n;
    const completedNodes = checkpointData?.completedNodes || {};

    // 拓扑排序，确定执行顺序
    const indegree: Record<string, number> = {};
    const next: Record<string, string[]> = {};
    for (const n of workflow.nodes) { indegree[n.id] = 0; next[n.id] = []; }
    for (const e of edges) {
      const s = e.source || e.from || '';
      const t = e.target || e.to || '';
      if (indegree[t] !== undefined) indegree[t]++;
      if (next[s]) next[s].push(t);
    }
    const queue = workflow.nodes.filter(n => indegree[n.id] === 0).map(n => n.id);
    const order: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      order.push(id);
      for (const t of (next[id] || [])) {
        indegree[t]--;
        if (indegree[t] === 0) queue.push(t);
      }
    }

    // Extract start node's defaultPrompt as user task prefix
    const startNode = workflow.nodes.find(n => n.type === 'start');
    const startInstruction = startNode?.defaultPrompt ? `\n\n[补充指令]\n${startNode.defaultPrompt}` : '';

    // 为每个节点生成执行指令
    const steps: string[] = [];
    let stepNum = 0;
    for (const nodeId of order) {
      const node = nodeById[nodeId];
      if (!node) continue;
      if (node.type === 'start' || node.type === 'end') continue;

      stepNum++;
      const upstreamIds = edges
        .filter(e => (e.target || e.to) === nodeId)
        .map(e => e.source || e.from || '');

      // Check if this step was already completed (checkpoint resume)
      if (completedNodes[nodeId]) {
        const prevOutput = (completedNodes[nodeId].output || '').substring(0, 300);
        steps.push(`步骤 ${stepNum}: **${node.label || node.type}** (${node.type}) [已完成 - 跳过]\n` +
          `此步骤在之前的执行中已完成。输出摘要: ${prevOutput || '(无输出)'}\n` +
          `输出文件路径: .checkpoint/${nodeId}.output.md\n` +
          `直接使用该输出继续，不要重新执行此步骤。`);
        continue;
      }

      let instruction = '';
      switch (node.type) {
        case 'agent': {
          const agent = node.agentId ? AgentModel.findById(node.agentId) : null;
          const model = agent?.config?.model || node.config?.model || 'sonnet';
          const rolePrompt = agent?.config?.systemPrompt || node.config?.systemPrompt || '';
          const task = node.defaultPrompt || node.config?.systemPrompt || '执行分配的任务';

          // 自动推断 agentType（如果节点没有明确指定）
          // Claude Agent SDK 实际支持的类型: claude, Explore, general-purpose, Plan, statusline-setup
          let agentType = node.agentType || node.config?.agentType;
          if (!agentType) {
            // 根据节点标签和任务描述推断类型
            const nodeLabel = String(node.label || '').toLowerCase();
            const taskDesc = String(task || '').toLowerCase();
            const rolePromptStr = String(rolePrompt || '');
            const combined = `${nodeLabel} ${taskDesc} ${rolePromptStr.substring(0, 200).toLowerCase()}`;

            // Explore 类型：搜索、查找、探索、研究、分析、收集（只读，不能创建文件）
            if (combined.includes('搜索') || combined.includes('查找') || combined.includes('探索') ||
                combined.includes('search') || combined.includes('find') || combined.includes('explore') ||
                combined.includes('研究') || combined.includes('分析') || combined.includes('收集') ||
                combined.includes('复现') || combined.includes('根因')) {
              agentType = 'Explore';
            }
            // general-purpose 类型：开发、测试、文档、创建等需要写入操作的任务
            else if (combined.includes('开发') || combined.includes('编写') || combined.includes('修改') ||
                     combined.includes('implement') || combined.includes('build') || combined.includes('创建') ||
                     combined.includes('配置') || combined.includes('设置') || combined.includes('修复') ||
                     combined.includes('create') || combined.includes('config') || combined.includes('setup') ||
                     combined.includes('fix') || combined.includes('构建') ||
                     combined.includes('测试') || combined.includes('验证') || combined.includes('检查') ||
                     combined.includes('test') || combined.includes('verify') || combined.includes('check') ||
                     combined.includes('审查') || combined.includes('质量') || combined.includes('回归') ||
                     combined.includes('review') || combined.includes('quality') || combined.includes('regression') ||
                     combined.includes('文档') || combined.includes('readme') || combined.includes('doc') ||
                     combined.includes('撰写') || combined.includes('审校') || combined.includes('发布') ||
                     combined.includes('大纲') || combined.includes('设计') || combined.includes('write') ||
                     combined.includes('publish') || combined.includes('outline') || combined.includes('design')) {
              agentType = 'general-purpose';
            }
            // 默认使用 general-purpose
            else {
              agentType = 'general-purpose';
            }
          }

          const isReadOnly = agentType === 'Explore';
          const agentTypeDesc = isReadOnly ? ' (只读探索)' : ' (完整权限)';

          // 检测分叉：当前节点是否有多个出边
          const outgoingEdges = edges.filter(e => (e.source || e.from) === nodeId);
          const downstreamIds = outgoingEdges.map(e => e.target || e.to);

          if (downstreamIds.length > 1) {
            // 分叉节点：并行执行所有下游 Agent
            const parallelCalls = downstreamIds.map(id => {
              const childNode = nodeById[id];
              const childTask = childNode?.defaultPrompt || childNode?.config?.systemPrompt || '执行分配的任务';
              const childAgentType = childNode?.agentType || 'general-purpose';
              return `      - call_sub_agent(agent_type: "${childAgentType}", prompt: "${childTask}", run_in_background: true)`;
            }).join('\n');

            instruction = `【分叉并行 — 必须在同一条消息中同时启动所有下游 Agent】\n` +
              `   1. 在同一条回复中同时调用以下所有工具（一个消息块包含多个 tool_use）：\n` +
              parallelCalls + '\n' +
              `   2. 所有后台子 Agent 并发启动后，此步骤即完成\n` +
              `   3. 下游汇聚节点会自动等待所有上游任务完成\n` +
              `   4. 禁止分多条消息逐个调用 — 必须一次性全部发出\n\n` +
              `【必须调用 call_sub_agent 工具，禁止自己直接执行】\n` +
              `调用: call_sub_agent(agent_type: "${agentType}", prompt: "${task}")\n` +
              `该 Agent 使用模型: ${model}, 类型: ${agentType}${agentTypeDesc}`;
          } else {
            // 普通节点：单个执行
            instruction = `【必须调用 call_sub_agent 工具，禁止自己直接执行】\n` +
              `调用: call_sub_agent(agent_type: "${agentType}", prompt: "${task}")\n` +
              `该 Agent 使用模型: ${model}, 类型: ${agentType}${agentTypeDesc}${rolePrompt ? ', 角色: ' + rolePrompt.substring(0, 200) : ''}` +
              (upstreamIds.length ? `\n上游依赖: ${upstreamIds.map(id => nodeById[id]?.label || id).join(', ')} 已完成，子 Agent 会自动读取工作区中的上游输出` : '');
          }
          break;
        }
        case 'subworkflow': {
          const subWfId = node.config?.subWorkflowId || node.config?.workflowId;
          if (!subWfId) {
            instruction = `子工作流节点 "${node.label || 'subworkflow'}" 未配置子工作流 ID，跳过此节点。`;
            break;
          }
          const subWf = require('../models/Workflow').findById(subWfId);
          if (!subWf) {
            instruction = `子工作流 "${subWfId}" 未找到，跳过此节点。`;
            break;
          }
          const subSystemPrompt = MasterAgentService.buildSystemPrompt(subWf, '执行子工作流任务', workingDir);
          const stepsMatch = subSystemPrompt.match(/=== 执行步骤 ===\n按以下顺序依次执行每个步骤：\n\n([\s\S]*?)(?:\n=== 必须遵守 ===)/);
          const subStepsText = stepsMatch
            ? stepsMatch[1].trim()
            : subWf.nodes.filter((n: WorkflowNode) => n.type !== 'start' && n.type !== 'end')
                .map((sn: WorkflowNode, si: number) => `  步骤 ${si + 1}: **${sn.label || sn.type}** (${sn.type})`).join('\n');
          instruction = `调用子工作流 "${subWf.name || subWfId}" (${subWfId})：\n` +
            `将以下子工作流的所有步骤作为主流程的一部分内联执行（不启动独立进程），完成后继续主流程的下一个步骤：\n\n${subStepsText}`;
          break;
        }
        case 'condition': {
          const pattern = node.config?.pattern || node.config?.condition || '';
          const trueLabel = node.config?.trueLabel || '通过';
          const falseLabel = node.config?.falseLabel || '不通过';

          // Find downstream nodes for each branch
          const trueTargets = edges
            .filter(e => (e.source || e.from) === nodeId && (e.label === 'true' || e.label === '通过' || !e.label))
            .map(e => e.target || e.to || '');
          const falseTargets = edges
            .filter(e => (e.source || e.from) === nodeId && (e.label === 'false' || e.label === '不通过'))
            .map(e => e.target || e.to || '');

          instruction = `【条件判断节点 — 根据上游输出决定执行哪个分支】\n` +
            `   1. 读取上游节点的输出\n` +
            `   2. 判断条件: "${pattern}"\n` +
            `   3. 如果条件满足（输出包含 "${pattern}"）:\n` +
            (trueTargets.length > 0
              ? trueTargets.map(id => {
                  const targetNode = nodeById[id];
                  const targetAgentType = targetNode?.agentType || 'general-purpose';
                  return `      - call_sub_agent(agent_type: "${targetAgentType}", prompt: "${targetNode?.defaultPrompt || '执行任务'}")`;
                }).join('\n')
              : '      - 继续执行后续步骤') + '\n' +
            `   4. 如果条件不满足:\n` +
            (falseTargets.length > 0
              ? falseTargets.map(id => {
                  const targetNode = nodeById[id];
                  const targetAgentType = targetNode?.agentType || 'general-purpose';
                  return `      - call_sub_agent(agent_type: "${targetAgentType}", prompt: "${targetNode?.defaultPrompt || '执行任务'}")`;
                }).join('\n')
              : '      - 跳过此分支，继续执行后续步骤') + '\n' +
            `   5. 输出: [条件判断] 条件"${pattern}" ${trueLabel}/${falseLabel}，执行了${trueTargets.length > 0 ? '通过' : '不通过'}分支`;
          break;
        }
        case 'approval': {
          const approvalTitle = node.config?.approvalTitle || node.label || '审核请求';
          const approvalDesc = node.config?.approvalDescription || '';
          instruction = `人工审核节点：${approvalTitle}\n` +
            `   1. 整理当前工作成果，准备好需要审核的内容\n` +
            `   2. 调用 request_approval 工具请求人工审核：\n` +
            `      - title: "${approvalTitle}"\n` +
            `      - description: "${approvalDesc}"\n` +
            `      - content: 将上游节点的输出或当前阶段的成果作为审核内容\n` +
            `   3. 该工具会暂停执行并弹出审核窗口，等待人工决策\n` +
            `   4. 根据返回结果：审核通过→继续执行后续节点；审核拒绝→记录原因并调整`;
          break;
        }
        default:
          instruction = `执行节点: ${node.type}`;
      }

      steps.push(`步骤 ${stepNum}: **${node.label || node.type}** (${node.type})\n${instruction}`);
    }

    // ── 注入工作流上下文（记忆、知识、技能） ──
    // 默认关闭记忆注入，只有显式开启才注入
    const memoryEnabled = workflow.memoryEnabled === true;
    const injections: string[] = [];

    // 1. 工作流记忆（仅在 memoryEnabled=true 时注入）
    if (memoryEnabled) {
      try {
        const MemoryService = require('./MemoryService');
        const memCtx = MemoryService.injectMemoryFiltered(workflow.id, userInput);
        if (memCtx) injections.push(memCtx);

        // 跨工作流记忆
        const memSource = workflow.memorySource;
        if (memSource) {
          const sourceIds = memSource.type === 'all'
            ? MemoryService.listMemories().filter((m: any) => m.workflowId !== workflow.id).map((m: any) => m.workflowId)
            : (memSource.type === 'workflow' && memSource.workflowId ? [memSource.workflowId] : []);
          const WorkflowModel = require('../models/Workflow');
          for (const srcId of sourceIds.slice(0, 5)) {
            const srcWf = WorkflowModel.findById(srcId);
            if (!srcWf) continue;
            const srcMem = MemoryService.injectMemory(srcId);
            if (srcMem) injections.push(`[来自工作流 "${srcWf.name}" 的记忆]\n${srcMem.substring(0, 5000)}`);
          }
        }

        // 共享池
        const pool = MemoryService.getSharedPool();
        const poolKeys = Object.keys(pool.variables || {});
        if (poolKeys.length > 0 || (pool.notes || []).length > 0) {
          injections.push(`[共享数据池]\n${JSON.stringify({ variables: pool.variables, notes: pool.notes }, null, 2).substring(0, 3000)}`);
        }
      } catch (_) {}
    }

    // 2. 知识库
    try {
      const ks = workflow.knowledgeSource;
      if (ks) {
        const KnowledgeService = require('./KnowledgeService');
        let entries = ks.type === 'entries' && Array.isArray(ks.entryIds)
          ? ks.entryIds.map((kid: string) => KnowledgeService.getAll().find((k: any) => k.id === kid)).filter(Boolean)
          : (ks.type === 'category' && ks.category ? (KnowledgeService.search('', { category: ks.category, limit: 50 }).items || []) : []);
        if (entries.length > 0) {
          injections.push(`[知识库参考]\n${entries.map((k: any) => `### ${k.title}\n${k.content}`).join('\n\n').substring(0, 8000)}`);
        }
      }
    } catch (_) {}

    // 3. Agent 的技能和 MCP 工具
    try {
      const SkillService = require('./SkillService');
      const McpService = require('./McpService');
      const agentNodes = workflow.nodes.filter(n => n.type === 'agent' && n.agentId);
      const allSkills = new Map<string, any>(), allMcp = new Map<string, any>();
      for (const n of agentNodes) {
        for (const s of SkillService.getByAgent(n.agentId)) { if (!allSkills.has(s.name)) allSkills.set(s.name, s); }
        for (const m of McpService.getByAgent(n.agentId)) { if (!allMcp.has(m.name)) allMcp.set(m.name, m); }
      }
      if (allSkills.size > 0) {
        injections.push(`[已安装技能]\n${[...allSkills.values()].map((s: any) => `- ${s.name} (${s.category}): ${s.description}`).join('\n')}`);
      }
      if (allMcp.size > 0) {
        injections.push(`[已安装 MCP 工具]\n${[...allMcp.values()].map((m: any) => `- ${m.name}: ${m.description}${m.endpoint ? ' [端点: ' + m.endpoint + ']' : ''}`).join('\n')}`);
      }
    } catch (_) {}

    const injectionBlock = injections.length > 0 ? '\n=== 可用上下文 ===\n' + injections.join('\n\n') + '\n' : '';

    // 统计可执行步骤数
    const executableCount = steps.filter(s => !s.includes('[已完成 - 跳过]')).length;

    // ── 提示词预算控制 ──
    // 确保总提示词不会超出模型上下文窗口
    const PROMPT_BUDGET = 80000; // 80K 字符（约 40K tokens，留足空间给对话历史）
    const basePromptSize = 3000; // 预估基础指令大小
    const stepsSize = steps.join('\n\n').length;
    const availableForInjections = PROMPT_BUDGET - basePromptSize - stepsSize;

    let finalInjectionBlock = '';
    if (injectionBlock.length > 0) {
      if (injectionBlock.length <= availableForInjections) {
        // 预算充足，全部注入
        finalInjectionBlock = injectionBlock;
      } else {
        // 预算不足，按优先级压缩
        // 优先级：记忆 > 知识 > 技能/MCP（记忆对执行最相关）
        const compressedInjections: string[] = [];
        let remaining = availableForInjections;

        for (const injection of injections) {
          if (remaining <= 0) break;
          const truncated = injection.substring(0, remaining);
          compressedInjections.push(truncated);
          remaining -= truncated.length;
        }

        finalInjectionBlock = '\n=== 可用上下文 ===\n' + compressedInjections.join('\n\n') + '\n';
        logger.warn(`Prompt budget exceeded, truncated injections: ${injectionBlock.length} -> ${finalInjectionBlock.length} chars`);
      }
    }

    // Agent 类型说明
    const agentTypesInfo: string = '- Explore: 只读探索（搜索、分析、只读操作）\n- general-purpose: 完整权限（读写执行全权限）';

    // 检测工作流中的分叉和汇聚节点
    const forkNodes: string[] = [];
    const mergeNodes: string[] = [];
    for (const n of workflow.nodes) {
      if (n.type === 'start' || n.type === 'end') continue;
      const outEdges = edges.filter(e => (e.source || e.from) === n.id);
      const inEdges = edges.filter(e => (e.target || e.to) === n.id);
      if (outEdges.length > 1) forkNodes.push(n.id);
      if (inEdges.length > 1) mergeNodes.push(n.id);
    }

    // 构建并行执行说明
    let parallelInstructions = '';
    if (forkNodes.length > 0) {
      parallelInstructions = `
=== 并行执行规则 ===
检测到 ${forkNodes.length} 个分叉节点，需要并行执行：

分叉节点列表:
${forkNodes.map(id => {
  const node = nodeById[id];
  const downstream = edges.filter(e => (e.source || e.from) === id).map(e => e.target || e.to);
  return `- ${node?.label || id}: 分叉为 ${downstream.length} 个并行分支`;
}).join('\n')}

执行规则:
1. 当执行到分叉节点时，先完成当前节点的任务
2. 然后在同一回复中同时调用所有下游 call_sub_agent 工具
3. 每个下游 Agent 必须使用 run_in_background: true
4. 系统会自动等待所有并行任务完成后再继续

示例:
{
  "content": [
    { "type": "text", "text": "完成当前任务，启动并行分支" },
    { "type": "tool_use", "name": "call_sub_agent", "input": { "agent_type": "general-purpose", "prompt": "任务描述", "run_in_background": true } },
    { "type": "tool_use", "name": "call_sub_agent", "input": { "agent_type": "general-purpose", "prompt": "任务描述", "run_in_background": true } }
  ]
}
`;
    }

    // 构建汇聚节点说明
    let mergeInstructions = '';
    if (mergeNodes.length > 0) {
      mergeInstructions = `
=== 汇聚节点规则 ===
检测到 ${mergeNodes.length} 个汇聚节点（多条入边）:

汇聚节点列表:
${mergeNodes.map(id => {
  const node = nodeById[id];
  const upstream = edges.filter(e => (e.target || e.to) === id).map(e => e.source || e.from);
  return `- ${node?.label || id}: 等待 ${upstream.length} 个上游任务完成`;
}).join('\n')}

执行规则:
1. 汇聚节点会自动等待所有上游任务完成
2. 当所有上游任务完成后，系统会自动触发汇聚节点执行
3. 汇聚节点可以读取所有上游任务的输出
`;
    }

    return `你是一个工作流执行引擎。你的唯一职责是按以下精确顺序执行任务，绝不做其他事。

工作目录: ${workingDir}
当前日期: ${new Date().toISOString().slice(0, 10)}
可执行步骤总数: ${executableCount} 个（不含已跳过的步骤）

╔══════════════════════════════════════════╗
║  强制执行规则 — 违反任何一条即为失败  ║
╚══════════════════════════════════════════╝

R1. 你必须恰好执行 ${executableCount} 个可执行步骤，不得多也不得少。
R2. 每个标记为 (agent) 的步骤 ==必须== 使用 Agent 工具派发子 Agent 执行。
    禁止自己直接处理 agent 步骤。你的角色是调度器，不是执行者。
    ⚠️ 重要：你绝对不能自己执行 agent 步骤的任务内容。
    ⚠️ 重要：你必须调用对应的 Agent 工具，让子 Agent 来执行任务。
R3. 每个标记为 [已完成 - 跳过] 的步骤 ==绝对不要== 重新执行。
R4. 严格按步骤编号顺序执行。步骤N完成后再开始步骤N+1。
R5. 每完成一个步骤，立即输出: [步骤 X/${steps.length} 完成]
R6. 审核反馈循环：如果某个审查/审核步骤发现问题，你必须回到问题对应的上游步骤，重新调用该上游的 Agent 工具修复问题，然后重新跑审查步骤验证。此循环可重复直到审核通过或无新问题。
R7. 分叉节点必须并行执行：当一个节点有多条出边时，必须在同一回复中同时调用所有下游 Agent。
R8. 条件节点根据上游输出判断分支：检查输出是否包含指定条件，选择执行对应分支的 Agent。
R9. 审批节点需要人工确认：调用 request_approval 工具后暂停执行，等待用户审批。

=== 可用的 Agent 类型（Claude Agent SDK）===
- Explore: 用于搜索和探索代码（只读权限，不能创建或修改文件）
- general-purpose: 用于所有需要写入操作的任务（完整权限，包括开发、测试、文档、创建文件等）

⚠️ 重要：只有 Explore 和 general-purpose 两种类型可用！
- 如果任务需要创建/修改文件，必须使用 general-purpose
- 如果任务只需要搜索/分析，可以使用 Explore

=== 用户任务 ===
${userInput}${startInstruction}

=== 执行步骤 ===
${steps.join('\n\n')}
${finalInjectionBlock}
${parallelInstructions}
${mergeInstructions}
=== 条件判断规则 ===
条件节点会显示为 "条件: [条件描述]"，执行时:
1. 读取上游节点的输出
2. 检查输出是否包含条件描述中的关键词
3. 如果包含（条件为真）: 执行 "通过" 分支的 Agent
4. 如果不包含（条件为假）: 执行 "不通过" 分支的 Agent
5. 输出格式: [条件判断] 条件"xxx" 通过/不通过，执行了xxx分支

=== 审批节点规则 ===
审批节点会显示为 "审批: [审批标题]"，执行时:
1. 调用 request_approval 工具请求人工审批
2. 参数: { title: "审批标题", description: "审批描述", content: "需要审批的内容" }
3. 系统会暂停执行并通知用户
4. 等待用户审批结果（超时1小时）
5. 如果通过: 继续执行后续步骤
6. 如果拒绝: 根据拒绝原因调整策略，可以重试或跳过

=== 执行规范 ===
1. 每个 agent 步骤: 调用 Agent 工具。参数: task="<该步骤的任务描述>"（必须包含具体的任务描述，不要使用默认值）
2. 每个步骤完成后: 用 write_to_file 保存输出到 .checkpoint/<步骤描述>.output.md
3. 子 Agent 的模型参数必须使用步骤中指定的 model 值，不要自行更改
4. 子 Agent 的输出文件保存到工作目录，后续步骤可以直接读取
5. 某个子 Agent 失败时: 读取错误信息 → 调整参数 → 重试一次 → 仍失败则记录错误继续
6. 审核反馈循环: 审查节点发现问题 → 重新调用出问题的上游 call_sub_agent 修复 → 再次审查 → 直到通过
7. 这是全自动流水线，不要向用户提问或请求确认（审批节点除外）
8. 分叉节点必须并行调用所有下游 call_sub_agent，不能逐个调用
9. 条件节点根据上游输出判断分支，输出条件判断结果
10. 审批节点调用 request_approval 后暂停，等待用户审批

=== 工具调用示例 ===

1. 普通 Agent 调用:
{
  "name": "call_sub_agent",
  "input": {
    "agent_type": "general-purpose",
    "prompt": "搜索关于JavaScript的最新特性"
  }
}

2. 并行 Agent 调用（分叉节点）:
{
  "content": [
    { "type": "text", "text": "启动并行分支" },
    { "type": "tool_use", "name": "call_sub_agent", "input": { "agent_type": "general-purpose", "prompt": "任务A", "run_in_background": true } },
    { "type": "tool_use", "name": "call_sub_agent", "input": { "agent_type": "general-purpose", "prompt": "任务B", "run_in_background": true } }
  ]
}

3. 条件判断:
[条件判断] 条件"包含错误" 通过/不通过，执行了通过分支

4. 审批请求:
{
  "name": "request_approval",
  "input": {
    "title": "代码审查",
    "description": "请审查生成的代码",
    "content": "生成的代码内容..."
  }
}

⚠️ 重要：task 参数必须包含具体的任务描述，不能是空字符串或默认值。
⚠️ 重要：你不能自己执行任务，必须调用 Agent 工具让子 Agent 执行。
⚠️ 重要：分叉节点必须在同一回复中同时调用所有下游 Agent。

=== 输出格式 ===
最终输出末尾必须包含:
[文件清单]
- 文件名: 用途简述
[执行摘要]
- 总共执行了 N 个步骤，成功 X 个，失败 Y 个
- 并行分支: A 个
- 条件判断: B 个
- 审批请求: C 个

=== 文件清理 ===
所有步骤完成后:
a. 保留最终交付物（与用户任务直接相关的文件）
b. 删除 draft_、temp_、scratch_ 前缀的临时文件
c. 将分析草稿、中间笔记移入 _intermediate/ 子目录
d. [文件清单] 中只列出最终交付物`;
    } catch (err: any) {
      logger.error('buildSystemPrompt error:', { message: err.message, stack: err.stack });
      throw err;
    }
  }
}

// 使用 CommonJS 导出以保持与现有路由的兼容性
module.exports = MasterAgentService;
module.exports.MasterAgentService = MasterAgentService;
module.exports.default = MasterAgentService;
