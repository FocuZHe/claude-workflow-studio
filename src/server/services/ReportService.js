const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class ReportService {
  static _baseDir = null;

  static init(workspaceRoot) {
    ReportService._baseDir = path.join(workspaceRoot, 'reports');
    if (!fs.existsSync(ReportService._baseDir)) {
      fs.mkdirSync(ReportService._baseDir, { recursive: true });
    }
  }

  static generateReport(workflow, executionLog) {
    const nodes = workflow.nodes || [];
    const nodeResults = executionLog.nodeResults || [];
    const duration = executionLog.completedAt && executionLog.startedAt
      ? Math.round((new Date(executionLog.completedAt) - new Date(executionLog.startedAt)) / 1000)
      : null;

    let md = `# 工作流执行报告\n\n`;
    md += `**工作流:** ${workflow.name}\n`;
    md += `**运行ID:** ${executionLog.runId}\n`;
    md += `**状态:** ${executionLog.status}\n`;
    md += `**开始时间:** ${executionLog.startedAt || 'N/A'}\n`;
    md += `**完成时间:** ${executionLog.completedAt || 'N/A'}\n`;
    if (duration !== null) md += `**耗时:** ${duration}秒\n`;
    md += `\n`;

    const inputStr = executionLog.input ? (typeof executionLog.input === 'string' ? executionLog.input : JSON.stringify(executionLog.input, null, 2)) : 'N/A';
    md += `## 输入\n\n\`\`\`\n${inputStr.substring(0, 1000)}\n\`\`\`\n\n`;

    md += `## 节点执行结果\n\n`;
    for (const node of nodes) {
      // 从执行快照中读取该节点的状态（而非当前节点状态）
      const result = nodeResults.find(r => r.nodeId === node.id);
      const status = result?.status || 'pending';
      const output = result?.output || null;
      const startedAt = result?.startedAt || null;
      const completedAt = result?.completedAt || null;

      md += `### ${node.label || node.id} (${node.type})\n`;
      md += `- **状态:** ${status}\n`;
      if (startedAt) md += `- **开始:** ${startedAt}\n`;
      if (completedAt) md += `- **完成:** ${completedAt}\n`;
      if (output) {
        md += `- **输出:**\n\`\`\`\n${String(output).substring(0, 500)}\n\`\`\`\n`;
      }
      md += `\n`;
    }

    return md;
  }

  static saveReport(workflowId, runId, content) {
    try {
      if (!ReportService._baseDir) return null;
      const dir = path.join(ReportService._baseDir, workflowId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${runId}.md`);
      fs.writeFileSync(filePath, content, 'utf-8');
      logger.info(`Report saved: ${workflowId}/${runId}`);
      return filePath;
    } catch (e) {
      logger.error(`Failed to save report: ${e.message}`);
      return null;
    }
  }

  static listReports(workflowId, options = {}) {
    try {
      if (!ReportService._baseDir) return { items: [], total: 0 };
      const { page = 1, limit = 20, search } = options;
      let result = [];

      if (workflowId) {
        const dir = path.join(ReportService._baseDir, workflowId);
        if (!fs.existsSync(dir)) return { items: [], total: 0 };
        result = fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
          const filePath = path.join(dir, f);
          const stat = fs.statSync(filePath);
          return {
            workflowId,
            runId: f.replace('.md', ''),
            path: filePath,
            createdAt: stat.birthtime.toISOString(),
            size: stat.size
          };
        });
      } else {
        if (!fs.existsSync(ReportService._baseDir)) return { items: [], total: 0 };
        for (const wfDir of fs.readdirSync(ReportService._baseDir)) {
          const wfPath = path.join(ReportService._baseDir, wfDir);
          if (fs.statSync(wfPath).isDirectory()) {
            for (const f of fs.readdirSync(wfPath)) {
              if (f.endsWith('.md')) {
                const filePath = path.join(wfPath, f);
                const stat = fs.statSync(filePath);
                result.push({
                  workflowId: wfDir,
                  runId: f.replace('.md', ''),
                  path: filePath,
                  createdAt: stat.birthtime.toISOString(),
                  size: stat.size
                });
              }
            }
          }
        }
      }

      // Apply search filter
      if (search) {
        const searchLower = search.toLowerCase();
        result = result.filter(r => r.workflowId.toLowerCase().includes(searchLower));
      }

      // Sort by createdAt descending
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Paginate
      const total = result.length;
      const start = (page - 1) * limit;
      const paginated = result.slice(start, start + limit);

      return { items: paginated, total, page, limit };
    } catch (e) { return { items: [], total: 0 }; }
  }

  static getReport(workflowId, runId) {
    try {
      if (!ReportService._baseDir) return null;
      const filePath = path.join(ReportService._baseDir, workflowId, `${runId}.md`);
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath, 'utf-8');
    } catch (e) { return null; }
  }

  static deleteReport(workflowId, runId) {
    try {
      if (!ReportService._baseDir) return false;
      const filePath = path.join(ReportService._baseDir, workflowId, `${runId}.md`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    } catch (e) { return false; }
  }

  static generateReportFromHistory(workflowId, runId) {
    const WorkflowModel = require('../models/Workflow');
    const workflow = WorkflowModel.findById(workflowId);
    if (!workflow) return { error: '工作流未找到' };

    const executionLog = (workflow.executionLog || []).find(log => log.runId === runId);
    if (!executionLog) return { error: 'Execution log not found' };

    const content = this.generateReport(workflow, executionLog);
    const filePath = this.saveReport(workflowId, runId, content);
    if (!filePath) return { error: 'Failed to save report' };

    return {
      workflowId,
      runId,
      content,
      filePath,
      createdAt: new Date().toISOString()
    };
  }

  static getReportMeta(workflowId, runId) {
    try {
      if (!ReportService._baseDir) return null;
      const filePath = path.join(ReportService._baseDir, workflowId, `${runId}.md`);
      if (!fs.existsSync(filePath)) return null;
      const stat = fs.statSync(filePath);
      return {
        workflowId,
        runId,
        createdAt: stat.birthtime.toISOString(),
        size: stat.size
      };
    } catch (e) { return null; }
  }
}

module.exports = ReportService;
