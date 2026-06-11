const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const { createApp } = require('../../dist/server/app');
const { getApiKey } = require('../../dist/server/middleware/auth');
const WorkflowModel = require('../../dist/server/models/Workflow');
const ReportService = require('../../dist/server/services/ReportService');

let server;
let baseUrl;

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': getApiKey(),
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, body: parsed, raw: data, headers: res.headers });
        } catch (e) {
          // For non-JSON responses (like markdown), return the raw data
          resolve({ status: res.statusCode, body: null, raw: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

describe('Reports API', () => {
  before(async () => {
    const { app } = createApp();
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Initialize ReportService with a test directory
    const testDir = path.join(__dirname, '../../temp-test-reports');
    ReportService.init(testDir);
  });

  after(() => {
    // Clean up test directory
    const testDir = path.join(__dirname, '../../temp-test-reports');
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    return new Promise(resolve => server.close(resolve));
  });

  beforeEach(() => {
    WorkflowModel.clear();
    // Clean up any existing test reports
    const testDir = path.join(__dirname, '../../temp-test-reports');
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  describe('GET /api/reports', () => {
    it('should return empty list when no reports exist', async () => {
      const res = await request('GET', '/api/reports');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.deepStrictEqual(res.body.data.items, []);
      assert.strictEqual(res.body.data.total, 0);
    });

    it('should return reports with metadata', async () => {
      // Create a workflow and execution log
      const workflow = WorkflowModel.create({ name: 'Test WF' });
      WorkflowModel.addExecutionLog(workflow.id, {
        runId: 'run-001',
        startedAt: new Date('2025-01-01T00:00:00Z'),
        completedAt: new Date('2025-01-01T00:01:00Z'),
        status: 'completed',
        nodeResults: []
      });

      // Generate report
      const result = ReportService.generateReportFromHistory(workflow.id, 'run-001');
      assert.ok(!result.error);

      // List reports
      const res = await request('GET', '/api/reports');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].workflowId, workflow.id);
      assert.strictEqual(res.body.data.items[0].runId, 'run-001');
      assert.ok(res.body.data.items[0].createdAt);
      assert.ok(res.body.data.items[0].size > 0);
      assert.strictEqual(res.body.data.total, 1);
      assert.strictEqual(res.body.data.page, 1);
      assert.strictEqual(res.body.data.limit, 20);
    });

    it('should filter by workflowId', async () => {
      // Create two workflows
      const wf1 = WorkflowModel.create({ name: 'WF1' });
      const wf2 = WorkflowModel.create({ name: 'WF2' });

      // Generate reports for both
      WorkflowModel.addExecutionLog(wf1.id, {
        runId: 'run-1',
        startedAt: new Date(),
        status: 'completed',
        nodeResults: []
      });
      WorkflowModel.addExecutionLog(wf2.id, {
        runId: 'run-2',
        startedAt: new Date(),
        status: 'completed',
        nodeResults: []
      });

      ReportService.generateReportFromHistory(wf1.id, 'run-1');
      ReportService.generateReportFromHistory(wf2.id, 'run-2');

      // Filter by workflowId
      const res = await request('GET', `/api/reports?workflowId=${wf1.id}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.items.length, 1);
      assert.strictEqual(res.body.data.items[0].workflowId, wf1.id);
    });
  });

  describe('POST /api/reports/generate', () => {
    it('should return 400 when workflowId is missing', async () => {
      const res = await request('POST', '/api/reports/generate', { runId: 'run-001' });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.message.includes('workflowId and runId are required'));
    });

    it('should return 400 when runId is missing', async () => {
      const res = await request('POST', '/api/reports/generate', { workflowId: 'wf-1' });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    it('should return 404 for non-existent workflowId', async () => {
      const res = await request('POST', '/api/reports/generate', {
        workflowId: 'non-existent',
        runId: 'run-001'
      });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
    });

    it('should return 404 for non-existent execution log', async () => {
      const workflow = WorkflowModel.create({ name: 'Test WF' });
      const res = await request('POST', '/api/reports/generate', {
        workflowId: workflow.id,
        runId: 'non-existent-run'
      });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
    });

    it('should generate report successfully', async () => {
      const workflow = WorkflowModel.create({ name: 'Test WF' });
      WorkflowModel.addExecutionLog(workflow.id, {
        runId: 'run-001',
        startedAt: new Date(),
        completedAt: new Date(),
        status: 'completed',
        nodeResults: []
      });

      const res = await request('POST', '/api/reports/generate', {
        workflowId: workflow.id,
        runId: 'run-001'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.workflowId, workflow.id);
      assert.strictEqual(res.body.data.runId, 'run-001');
      assert.ok(res.body.data.content);
      assert.ok(res.body.data.createdAt);
    });
  });

  describe('GET /api/reports/:workflowId/:runId', () => {
    it('should return 404 for non-existent report', async () => {
      const res = await request('GET', '/api/reports/non-existent/run-001');
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
    });

    it('should return report content', async () => {
      const workflow = WorkflowModel.create({ name: 'Test WF' });
      WorkflowModel.addExecutionLog(workflow.id, {
        runId: 'run-001',
        startedAt: new Date(),
        completedAt: new Date(),
        status: 'completed',
        nodeResults: []
      });

      // Generate report first
      ReportService.generateReportFromHistory(workflow.id, 'run-001');

      const res = await request('GET', `/api/reports/${workflow.id}/run-001`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.content);
      assert.strictEqual(res.body.data.workflowId, workflow.id);
      assert.strictEqual(res.body.data.runId, 'run-001');
    });
  });

  describe('GET /api/reports/:workflowId/:runId/download', () => {
    it('should return 404 for non-existent report', async () => {
      const res = await request('GET', '/api/reports/non-existent/run-001/download');
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.success, false);
    });

    it('should download report as markdown file', async () => {
      const workflow = WorkflowModel.create({ name: 'Test WF' });
      WorkflowModel.addExecutionLog(workflow.id, {
        runId: 'run-001',
        startedAt: new Date(),
        completedAt: new Date(),
        status: 'completed',
        nodeResults: []
      });

      // Generate report first
      ReportService.generateReportFromHistory(workflow.id, 'run-001');

      const res = await request('GET', `/api/reports/${workflow.id}/run-001/download`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['content-type'], 'text/markdown; charset=utf-8');
      assert.ok(res.headers['content-disposition'].includes('attachment'));
      // res.raw is the raw response body
      const content = typeof res.raw === 'string' ? res.raw : String(res.raw);
      assert.ok(content.includes('# 工作流执行报告'));
    });
  });

  describe('DELETE /api/reports/:workflowId/:runId', () => {
    it('should delete report successfully', async () => {
      const workflow = WorkflowModel.create({ name: 'Test WF' });
      WorkflowModel.addExecutionLog(workflow.id, {
        runId: 'run-001',
        startedAt: new Date(),
        completedAt: new Date(),
        status: 'completed',
        nodeResults: []
      });

      // Generate report first
      ReportService.generateReportFromHistory(workflow.id, 'run-001');

      // Delete report
      const deleteRes = await request('DELETE', `/api/reports/${workflow.id}/run-001`);
      assert.strictEqual(deleteRes.status, 200);
      assert.strictEqual(deleteRes.body.success, true);
      assert.strictEqual(deleteRes.body.data.removed, true);

      // Verify report is gone
      const getRes = await request('GET', `/api/reports/${workflow.id}/run-001`);
      assert.strictEqual(getRes.status, 404);
    });
  });
});
