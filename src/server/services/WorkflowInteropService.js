const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class WorkflowInteropService {
  /**
   * Parse a Claude Code .md workflow file into structured steps
   * @param {string} content - Raw .md file content
   * @returns {Object} { description, model, steps: [{label, content}] }
   */
  static parseMarkdown(content) {
    const result = { description: '', model: '', steps: [] };

    // Parse frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];
      const descMatch = fm.match(/description:\s*(.+)/);
      if (descMatch) result.description = descMatch[1].trim();
      const modelMatch = fm.match(/model:\s*(.+)/);
      if (modelMatch) result.model = modelMatch[1].trim();
      content = content.slice(fmMatch[0].length).trim();
    }

    // Parse steps: ## Step N: ... or ## 步骤 N：... or ## N. ...
    const stepRegex = /^##\s+(?:步骤\s*)?(\d+)[：:.]\s*(.+)/gm;
    let match;
    const stepPositions = [];
    while ((match = stepRegex.exec(content)) !== null) {
      stepPositions.push({ index: match.index, label: match[2].trim(), num: parseInt(match[1]) });
    }

    if (stepPositions.length > 0) {
      for (let i = 0; i < stepPositions.length; i++) {
        const start = stepPositions[i].index;
        const end = i + 1 < stepPositions.length ? stepPositions[i + 1].index : content.length;
        const stepContent = content.slice(start, end).replace(/^##[^\n]*\n/, '').trim();
        result.steps.push({ label: stepPositions[i].label, content: stepContent });
      }
    } else {
      // Fallback: treat entire content as a single step
      if (content.trim()) {
        result.steps.push({ label: '执行任务', content: content.trim() });
      }
    }

    return result;
  }

  /**
   * Convert parsed steps to workflow nodes and edges
   * @param {Object} parsed - Output from parseMarkdown
   * @returns {Object} { nodes: [...], edges: [...] }
   */
  static toWorkflowDag(parsed) {
    const nodes = [];
    const edges = [];

    // Start node
    nodes.push({ id: 'n1', type: 'start', label: '开始', position: { x: 100, y: 200 }, config: {} });

    let prevId = 'n1';
    const startX = 300;
    const spacing = 250;

    parsed.steps.forEach((step, i) => {
      const nodeId = `n${i + 2}`;
      nodes.push({
        id: nodeId,
        type: 'agent',
        label: step.label,
        position: { x: startX + i * spacing, y: 200 },
        config: {
          systemPrompt: step.content,
          model: parsed.model || 'sonnet'
        }
      });
      edges.push({ id: `e${i + 1}`, source: prevId, target: nodeId });
      prevId = nodeId;
    });

    // End node
    const endId = `n${parsed.steps.length + 2}`;
    nodes.push({ id: endId, type: 'end', label: '结束', position: { x: startX + parsed.steps.length * spacing, y: 200 }, config: {} });
    edges.push({ id: `e${parsed.steps.length + 1}`, source: prevId, target: endId });

    return { nodes, edges };
  }

  /**
   * Export a workflow to Claude Code .md format
   * @param {Object} workflow - Workflow object with nodes and edges
   * @returns {string} .md formatted string
   */
  static toMarkdown(workflow) {
    let md = '---\n';
    md += `description: ${workflow.name || workflow.description || 'Exported workflow'}\n`;

    // Find agent nodes to determine model
    const agentNodes = (workflow.nodes || []).filter(n => n.type === 'agent');
    if (agentNodes.length > 0 && agentNodes[0].config?.model) {
      md += `model: ${agentNodes[0].config.model}\n`;
    }
    md += '---\n\n';

    // Topological sort to get execution order
    const sorted = WorkflowInteropService._topoSort(workflow.nodes, workflow.edges);

    let stepNum = 1;
    for (const node of sorted) {
      if (node.type === 'start' || node.type === 'end') continue;

      const label = node.label || `步骤 ${stepNum}`;
      md += `## 步骤 ${stepNum}：${label}\n`;

      if (node.config?.systemPrompt) {
        md += `${node.config.systemPrompt}\n`;
      }
      md += '\n';
      stepNum++;
    }

    return md.trim() + '\n';
  }

  /**
   * Simple topological sort for workflow nodes
   */
  static _topoSort(nodes, edges) {
    if (!nodes || !edges) return nodes || [];

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const adjacency = new Map();
    const indegree = new Map();

    for (const n of nodes) {
      adjacency.set(n.id, []);
      indegree.set(n.id, 0);
    }

    for (const e of edges) {
      const src = e.source || e.from;
      const tgt = e.target || e.to;
      if (src && tgt && adjacency.has(src) && indegree.has(tgt)) {
        adjacency.get(src).push(tgt);
        indegree.set(tgt, indegree.get(tgt) + 1);
      }
    }

    const queue = [];
    for (const [id, deg] of indegree) {
      if (deg === 0) queue.push(id);
    }

    const result = [];
    while (queue.length > 0) {
      const id = queue.shift();
      const node = nodeMap.get(id);
      if (node) result.push(node);
      for (const tgt of adjacency.get(id) || []) {
        indegree.set(tgt, indegree.get(tgt) - 1);
        if (indegree.get(tgt) === 0) queue.push(tgt);
      }
    }

    return result;
  }
}

module.exports = WorkflowInteropService;
