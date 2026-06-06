"use strict";
/**
 * WorkflowInteropService - 工作流互操作服务
 * 处理工作流之间的交互，以及工作流的导入/导出
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowInteropService = void 0;
class WorkflowInteropService {
    static messages = [];
    /**
     * 发送消息
     */
    static sendMessage(fromWorkflowId, toWorkflowId, type, data) {
        const message = {
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
    static getMessages(workflowId) {
        return this.messages.filter(msg => msg.toWorkflowId === workflowId || msg.fromWorkflowId === workflowId);
    }
    /**
     * 清空消息
     */
    static clearMessages() {
        this.messages = [];
    }
    /**
     * 解析 Claude Code .md 格式的工作流文件
     * 支持简单的 markdown 格式，提取标题、步骤和描述
     */
    static parseMarkdown(content) {
        const lines = content.split('\n');
        let name = '';
        let description = '';
        const steps = [];
        let currentStep = null;
        let stepIndex = 0;
        for (const line of lines) {
            const trimmed = line.trim();
            // 提取标题（第一个 # 开头的行）
            if (!name && trimmed.startsWith('# ')) {
                name = trimmed.substring(2).trim();
                continue;
            }
            // 提取步骤（## 开头的行）
            if (trimmed.startsWith('## ')) {
                if (currentStep) {
                    steps.push(currentStep);
                }
                stepIndex++;
                currentStep = {
                    id: `step_${stepIndex}`,
                    label: trimmed.substring(3).trim(),
                    type: 'agent',
                    description: '',
                    prompt: ''
                };
                continue;
            }
            // 提取步骤描述和提示词
            if (currentStep) {
                if (trimmed.startsWith('**Prompt:**') || trimmed.startsWith('prompt:')) {
                    currentStep.prompt = trimmed.replace(/^\*\*Prompt:\*\*|^prompt:/i, '').trim();
                }
                else if (trimmed && !currentStep.description) {
                    currentStep.description = trimmed;
                }
                else if (trimmed) {
                    currentStep.prompt += (currentStep.prompt ? '\n' : '') + trimmed;
                }
            }
            else if (trimmed && !description) {
                description = trimmed;
            }
        }
        // 添加最后一个步骤
        if (currentStep) {
            steps.push(currentStep);
        }
        return { name, description, steps };
    }
    /**
     * 将解析后的工作流转换为 DAG（节点和边）
     */
    static toWorkflowDag(parsed) {
        const nodes = [];
        const edges = [];
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
            const nodeId = step.id;
            nodes.push({
                id: nodeId,
                label: step.label,
                type: step.type || 'agent',
                position: { x: 80, y: 60 + (index + 1) * nodeGap },
                config: { systemPrompt: step.prompt || step.description },
                defaultPrompt: step.prompt || step.description,
                requiresInput: false
            });
            // 添加边
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
     */
    static toMarkdown(workflow) {
        const lines = [];
        // 标题
        lines.push(`# ${workflow.name || 'Untitled Workflow'}`);
        lines.push('');
        // 描述
        if (workflow.description) {
            lines.push(workflow.description);
            lines.push('');
        }
        // 节点（排除 start 和 end）
        const steps = (workflow.nodes || []).filter((n) => n.type !== 'start' && n.type !== 'end');
        for (const step of steps) {
            lines.push(`## ${step.label || step.id}`);
            lines.push('');
            if (step.config?.systemPrompt || step.defaultPrompt) {
                lines.push(`**Prompt:** ${step.config?.systemPrompt || step.defaultPrompt}`);
                lines.push('');
            }
        }
        return lines.join('\n');
    }
}
exports.WorkflowInteropService = WorkflowInteropService;
module.exports = WorkflowInteropService;
//# sourceMappingURL=WorkflowInteropService.js.map