/**
 * WorkflowInteropService - 工作流互操作服务
 * 处理工作流之间的交互，以及工作流的导入/导出（Claude Code .md 格式）
 *
 * .md 格式约定：
 *   ---
 *   description: <描述>
 *   model: <模型>
 *   ---
 *   ## 步骤 1：<标签>
 *   <内容>
 *   ## 步骤 2：<标签>
 *   <内容>
 */

export interface WorkflowMessage {
  id: string;
  fromWorkflowId: string;
  toWorkflowId: string;
  type: string;
  data: any;
  timestamp: Date;
}

export interface ParsedWorkflow {
  name: string;
  description: string;
  model?: string;
  steps: WorkflowStep[];
}

export interface WorkflowStep {
  id: string;
  label: string;
  type: string;
  description: string;
  prompt: string;
}

export class WorkflowInteropService {
  private static messages: WorkflowMessage[] = [];

  /**
   * 发送消息
   */
  static sendMessage(
    fromWorkflowId: string,
    toWorkflowId: string,
    type: string,
    data: any
  ): WorkflowMessage {
    const message: WorkflowMessage = {
      id: Math.random().toString(36).substring(7),
      fromWorkflowId,
      toWorkflowId,
      type,
      data,
      timestamp: new Date()
    };

    this.messages.push(message);
    return message;
  }

  /**
   * 获取消息
   */
  static getMessages(workflowId: string): WorkflowMessage[] {
    return this.messages.filter(
      msg => msg.toWorkflowId === workflowId || msg.fromWorkflowId === workflowId
    );
  }

  /**
   * 清空消息
   */
  static clearMessages(): void {
    this.messages = [];
  }

  /**
   * 从步骤标题行提取 label
   * 支持: "步骤 1：审查" / "步骤 1: 审查" / "1: Review" / "1：Review" / "审查"
   */
  private static _extractLabel(title: string): string {
    let label = title.trim();
    // 去掉 "步骤 N" 前缀（带中英文冒号）
    label = label.replace(/^步骤\s*\d+\s*[:：]\s*/i, '');
    // 去掉 "N:" 或 "N：" 前缀
    label = label.replace(/^\d+\s*[:：]\s*/, '');
    return label.trim();
  }

  /**
   * 解析 Claude Code .md 格式的工作流文件
   * 支持 frontmatter（--- 包裹的 YAML 头）+ ## 步骤
   */
  static parseMarkdown(content: string): ParsedWorkflow {
    const lines = content.split('\n');
    let name = '';
    let description = '';
    let model: string | undefined;
    const steps: WorkflowStep[] = [];

    let inFrontmatter = false;
    let frontmatterEnded = false;
    let currentStep: Partial<WorkflowStep> | null = null;
    let stepIndex = 0;
    let bodyText: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // frontmatter 检测
      if (trimmed === '---') {
        if (!inFrontmatter && !frontmatterEnded && lines.indexOf(line) === 0) {
          inFrontmatter = true;
          continue;
        }
        if (inFrontmatter) {
          inFrontmatter = false;
          frontmatterEnded = true;
          continue;
        }
      }

      // 解析 frontmatter 内容
      if (inFrontmatter) {
        const match = trimmed.match(/^([a-zA-Z_]+)\s*:\s*(.*)$/);
        if (match) {
          const key = match[1].toLowerCase();
          const value = match[2].trim();
          if (key === 'description') description = value;
          else if (key === 'model') model = value;
          else if (key === 'name') name = value;
        }
        continue;
      }

      // 提取标题（# 开头，非 ##）
      if (!name && /^#\s+/.test(trimmed) && !trimmed.startsWith('## ')) {
        name = trimmed.replace(/^#\s+/, '').trim();
        continue;
      }

      // 提取步骤（## 开头）
      if (/^##\s+/.test(trimmed)) {
        if (currentStep) {
          steps.push(currentStep as WorkflowStep);
        }
        stepIndex++;
        const title = trimmed.replace(/^##\s+/, '');
        currentStep = {
          id: `step_${stepIndex}`,
          label: this._extractLabel(title),
          type: 'agent',
          description: '',
          prompt: ''
        };
        continue;
      }

      // 步骤内容收集
      if (currentStep) {
        if (trimmed.startsWith('**Prompt:**') || /^prompt:/i.test(trimmed)) {
          currentStep.prompt = trimmed.replace(/^\*\*Prompt:\*\*|^prompt:/i, '').trim();
        } else if (trimmed) {
          if (!currentStep.description) {
            currentStep.description = trimmed;
          } else {
            currentStep.prompt += (currentStep.prompt ? '\n' : '') + trimmed;
          }
        }
      } else if (trimmed && frontmatterEnded) {
        bodyText.push(trimmed);
      }
    }

    // 添加最后一个步骤
    if (currentStep) {
      steps.push(currentStep as WorkflowStep);
    }

    // 无步骤时创建默认步骤（若有 body 内容，作为默认步骤的描述）
    if (steps.length === 0) {
      steps.push({
        id: 'step_1',
        label: '执行任务',
        type: 'agent',
        description: bodyText.join('\n') || '',
        prompt: ''
      });
    }

    const result: ParsedWorkflow = { name, description, steps };
    if (model) result.model = model;
    return result;
  }

  /**
   * 将解析后的工作流转换为 DAG（节点和边）
   * 从 parsed.model 设置 agent 节点的 config.model
   */
  static toWorkflowDag(parsed: ParsedWorkflow): { nodes: any[]; edges: any[] } {
    const nodes: any[] = [];
    const edges: any[] = [];
    const model = parsed.model;

    // 添加开始节点
    nodes.push({
      id: 'start',
      label: '开始',
      type: 'start',
      position: { x: 80, y: 60 },
      config: {},
      defaultPrompt: '',
      requiresInput: false
    });

    // 添加步骤节点
    let prevId = 'start';
    const nodeGap = 200;
    parsed.steps.forEach((step, index) => {
      const nodeId = step.id || `step_${index + 1}`;
      const prompt = step.prompt || step.description || (step as any).content || '';
      nodes.push({
        id: nodeId,
        label: step.label,
        type: step.type || 'agent',
        position: { x: 80, y: 60 + (index + 1) * nodeGap },
        config: {
          systemPrompt: prompt,
          ...(model ? { model } : {})
        },
        defaultPrompt: prompt,
        requiresInput: false
      });

      edges.push({
        id: `e_${prevId}_${nodeId}`,
        source: prevId,
        target: nodeId
      });

      prevId = nodeId;
    });

    // 添加结束节点
    nodes.push({
      id: 'end',
      label: '结束',
      type: 'end',
      position: { x: 80, y: 60 + (parsed.steps.length + 1) * nodeGap },
      config: {},
      defaultPrompt: '',
      requiresInput: false
    });

    edges.push({
      id: `e_${prevId}_end`,
      source: prevId,
      target: 'end'
    });

    return { nodes, edges };
  }

  /**
   * 将工作流导出为 Claude Code .md 格式
   * 生成 frontmatter（description/model）+ ## 步骤 N：label
   */
  static toMarkdown(workflow: any): string {
    const lines: string[] = [];

    const name = workflow.name || 'Untitled Workflow';
    const description = workflow.description || name;

    // 找第一个 agent 节点的 model
    const agentNodes = (workflow.nodes || []).filter(
      (n: any) => n.type !== 'start' && n.type !== 'end'
    );
    const model = agentNodes[0]?.config?.model;

    // frontmatter
    lines.push('---');
    lines.push(`description: ${description}`);
    if (model) {
      lines.push(`model: ${model}`);
    }
    lines.push('---');
    lines.push('');

    // 步骤（排除 start 和 end）
    const steps = agentNodes;
    steps.forEach((step: any, index: number) => {
      const label = step.label || step.id || `步骤 ${index + 1}`;
      lines.push(`## 步骤 ${index + 1}：${label}`);
      lines.push('');

      const prompt = step.config?.systemPrompt || step.defaultPrompt || '';
      if (prompt) {
        lines.push(`**Prompt:** ${prompt}`);
        lines.push('');
      }
    });

    return lines.join('\n');
  }
}

module.exports = WorkflowInteropService;
