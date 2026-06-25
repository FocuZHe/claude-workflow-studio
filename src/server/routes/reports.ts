const express = require('express');
const router = express.Router();
const ReportService = require('../services/ReportService');
const { AppError } = require('../middleware/errorHandler');

router.get('/', (req: any, res: any, next: any) => {
  try {
    const { workflowId, search, page, limit } = req.query;
    const result = ReportService.listReports(workflowId, {
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 20, 100),
      search
    });
    res.json({
      success: true,
      data: { items: result.items, total: result.total, page: result.page, limit: result.limit }
    });
  } catch (err) { next(err); }
});

router.post('/generate', (req: any, res: any, next: any) => {
  try {
    const { workflowId, runId } = req.body;
    if (!workflowId || !runId) {
      throw new AppError('VALIDATION_ERROR', 'workflowId and runId are required', 400);
    }
    const result = ReportService.generateReportFromHistory(workflowId, runId);
    if (result.error) {
      throw new AppError('GENERATION_FAILED', result.error, 404);
    }
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.get('/:workflowId/:runId', (req: any, res: any, next: any) => {
  try {
    const { workflowId, runId } = req.params;
    const report = ReportService.getReport(workflowId, runId);
    if (!report) throw new AppError('NOT_FOUND', '报告未找到', 404);
    res.json({ success: true, data: { content: report.content, workflowId, runId } });
  } catch (err) { next(err); }
});

router.get('/:workflowId/:runId/download', (req: any, res: any, next: any) => {
  try {
    const { workflowId, runId } = req.params;
    const report = ReportService.getReport(workflowId, runId);
    if (!report) throw new AppError('NOT_FOUND', '报告未找到', 404);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="report-${workflowId}-${runId}.md"`);
    res.send(report.content);
  } catch (err) { next(err); }
});

router.delete('/:workflowId/:runId', (req: any, res: any, next: any) => {
  try {
    ReportService.deleteReport(req.params.workflowId, req.params.runId);
    res.json({ success: true, data: { removed: true } });
  } catch (err) { next(err); }
});

module.exports = router;
