const AgentModel = require('../models/Agent');
const logger = require('../utils/logger');

/**
 * MasterAgentService — 将所有工作流转换为 Claude Code 原生多 Agent 协作模式
 *
 * 无论节点类型，均用一个主 claude 进程 + Agent 工具 / 原生能力实现，
 * 子 Agent 共享同一工作区，文件互见。
 */
class MasterAgentService {
  static canUseMasterAgent(workflow) {
    if (!workflow || !workflow.nodes || workflow.nodes.length === 0) return false;
    return true;
  }

  static buildSystemPrompt(workflow, userInput, workingDir, checkpointData) {
    const edges = workflow.edges || [];
    const nodeById = {};
    for (const n of workflow.nodes) nodeById[n.id] = n;
    const completedNodes = checkpointData?.completedNodes || {};

    // 拓扑排序，确定执行顺序
    const indegree = {};
    const next = {};
    for (const n of workflow.nodes) { indegree[n.id] = 0; next[n.id] = []; }
    for (const e of edges) {
      const s = e.source || e.from;
      const t = e.target || e.to;
      if (indegree[t] !== undefined) indegree[t]++;
      if (next[s]) next[s].push(t);
    }
    const queue = workflow.nodes.filter(n => indegree[n.id] === 0).map(n => n.id);
    const order = [];
    while (queue.length) {
      const id = queue.shift();
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
    const steps = [];
    let stepNum = 0;
    for (const nodeId of order) {
      const node = nodeById[nodeId];
      if (!node) continue;
      if (node.type === 'start' || node.type === 'end') continue;

      stepNum++;
      const upstreamIds = edges
        .filter(e => (e.target || e.to) === nodeId)
        .map(e => e.source || e.from);

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
          const task = node.defaultPrompt || '执行分配的任务';
          instruction = `【必须调用 Agent_${nodeId} 工具，禁止自己直接执行】\n` +
            `调用: Agent_${nodeId}({ task: "${task}" })\n` +
            `该 Agent 使用模型: ${model}${rolePrompt ? ', 角色: ' + rolePrompt.substring(0, 200) : ''}` +
            (upstreamIds.length ? `\n上游依赖: ${upstreamIds.map(id => nodeById[id]?.label || id).join(', ')} 已完成，子 Agent 会自动读取工作区中的上游输出` : '');
          break;
        }
        case 'parallel':
          instruction = `【并行执行节点 — 必须在同一条消息中同时启动所有下游 Agent】\n` +
            `   1. 在同一条回复中同时调用以下所有工具（一个消息块包含多个 tool_use）：\n` +
            (next[nodeId] || []).map(id => `      - Agent_${id}({ task: "${nodeById[id]?.defaultPrompt || '执行任务'}", run_in_background: true })`).join('\n') + '\n' +
            `   2. 所有后台子 Agent 并发启动后，此步骤即完成，继续执行后续的 merge 节点\n` +
            `   3. merge 节点会等待所有后台任务完成并合并结果\n` +
            `   4. 禁止分多条消息逐个调用 — 必须一次性全部发出`;
          break;
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
          const subSystemPrompt = this.buildSystemPrompt(subWf, '执行子工作流任务', workingDir);
          const stepsMatch = subSystemPrompt.match(/=== 执行步骤 ===\n按以下顺序依次执行每个步骤：\n\n([\s\S]*?)(?:\n=== 必须遵守 ===)/);
          const subStepsText = stepsMatch
            ? stepsMatch[1].trim()
            : subWf.nodes.filter(n => n.type !== 'start' && n.type !== 'end')
                .map((sn, si) => `  步骤 ${si + 1}: **${sn.label || sn.type}** (${sn.type})`).join('\n');
          instruction = `调用子工作流 "${subWf.name || subWfId}" (${subWfId})：\n` +
            `将以下子工作流的所有步骤作为主流程的一部分内联执行（不启动独立进程），完成后继续主流程的下一个步骤：\n\n${subStepsText}`;
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
    const injections = [];

    // 1. 工作流记忆
    try {
      const MemoryService = require('./MemoryService');
      const memCtx = MemoryService.injectMemoryFiltered(workflow.id, userInput);
      if (memCtx) injections.push(memCtx);

      // 跨工作流记忆
      const memSource = workflow.memorySource;
      if (memSource) {
        const sourceIds = memSource.type === 'all'
          ? MemoryService.listMemories().filter(m => m.workflowId !== workflow.id).map(m => m.workflowId)
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

    // 2. 知识库
    try {
      const ks = workflow.knowledgeSource;
      if (ks) {
        const KnowledgeService = require('./KnowledgeService');
        let entries = ks.type === 'entries' && Array.isArray(ks.entryIds)
          ? ks.entryIds.map(kid => KnowledgeService.getAll().find(k => k.id === kid)).filter(Boolean)
          : (ks.type === 'category' && ks.category ? (KnowledgeService.search('', { category: ks.category, limit: 50 }).items || []) : []);
        if (entries.length > 0) {
          injections.push(`[知识库参考]\n${entries.map(k => `### ${k.title}\n${k.content}`).join('\n\n').substring(0, 8000)}`);
        }
      }
    } catch (_) {}

    // 3. Agent 的技能和 MCP 工具
    try {
      const SkillService = require('./SkillService');
      const McpService = require('./McpService');
      const agentNodes = workflow.nodes.filter(n => n.type === 'agent' && n.agentId);
      const allSkills = new Map(), allMcp = new Map();
      for (const n of agentNodes) {
        for (const s of SkillService.getByAgent(n.agentId)) { if (!allSkills.has(s.name)) allSkills.set(s.name, s); }
        for (const m of McpService.getByAgent(n.agentId)) { if (!allMcp.has(m.name)) allMcp.set(m.name, m); }
      }
      if (allSkills.size > 0) {
        injections.push(`[已安装技能]\n${[...allSkills.values()].map(s => `- ${s.name} (${s.category}): ${s.description}`).join('\n')}`);
      }
      if (allMcp.size > 0) {
        injections.push(`[已安装 MCP 工具]\n${[...allMcp.values()].map(m => `- ${m.name}: ${m.description}${m.endpoint ? ' [端点: ' + m.endpoint + ']' : ''}`).join('\n')}`);
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
        const compressedInjections = [];
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
R3. 每个标记为 [已完成 - 跳过] 的步骤 ==绝对不要== 重新执行。
R4. 严格按步骤编号顺序执行。步骤N完成后再开始步骤N+1。
R5. 每完成一个步骤，立即输出: [步骤 X/${steps.length} 完成]
R6. 审核反馈循环：如果某个审查/审核步骤发现问题，你必须回到问题对应的上游步骤，重新调用该上游的 Agent 工具修复问题，然后重新跑审查步骤验证。此循环可重复直到审核通过或无新问题。

=== 用户任务 ===
${userInput}${startInstruction}

=== 执行步骤 ===
${steps.join('\n\n')}
${finalInjectionBlock}
=== 执行规范 ===
1. 每个 agent 步骤: 调用 Agent 工具。参数: description="<节点名称>", prompt="<该步骤的任务描述>", model="<指定模型>"
2. 每个步骤完成后: 用 write_to_file 保存输出到 .checkpoint/<步骤描述>.output.md
3. 子 Agent 的模型参数必须使用步骤中指定的 model 值，不要自行更改
4. 子 Agent 的输出文件保存到工作目录，后续步骤可以直接读取
5. 某个子 Agent 失败时: 读取错误信息 → 调整参数 → 重试一次 → 仍失败则记录错误继续
6. 审核反馈循环: 审查节点发现问题 → 重新调用出问题的上游 Agent_xxx 修复 → 再次审查 → 直到通过
7. 这是全自动流水线，不要向用户提问或请求确认（审批节点除外）

=== 输出格式 ===
最终输出末尾必须包含:
[文件清单]
- 文件名: 用途简述
[执行摘要]
- 总共执行了 N 个步骤，成功 X 个，失败 Y 个

=== 文件清理 ===
所有步骤完成后:
a. 保留最终交付物（与用户任务直接相关的文件）
b. 删除 draft_、temp_、scratch_ 前缀的临时文件
c. 将分析草稿、中间笔记移入 _intermediate/ 子目录
d. [文件清单] 中只列出最终交付物`;
  }
}

module.exports = MasterAgentService;
