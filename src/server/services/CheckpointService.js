const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class CheckpointService {
  static _baseDir = null;

  static init(workspaceRoot) {
    CheckpointService._baseDir = path.join(workspaceRoot, 'WORKFLOWS', 'checkpoints');
    if (!fs.existsSync(CheckpointService._baseDir)) {
      fs.mkdirSync(CheckpointService._baseDir, { recursive: true });
    }
  }

  static _getCheckpointPath(workflowId, runId) {
    if (!workflowId || !runId) throw new Error('Invalid workflowId or runId');
    if (workflowId.includes('..') || runId.includes('..')) throw new Error('Path traversal detected');
    const dir = path.join(CheckpointService._baseDir, workflowId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${runId}.json`);
  }

  static saveCheckpoint(workflowId, runId, data) {
    try {
      const filePath = CheckpointService._getCheckpointPath(workflowId, runId);
      const checkpoint = {
        workflowId,
        runId,
        timestamp: new Date().toISOString(),
        completedNodes: data.completedNodes || {},
        pendingNodes: data.pendingNodes || [],
        nodeOutputs: data.nodeOutputs || {},
        workflowInput: data.workflowInput || null,
        executionContext: data.executionContext || {}
      };
      fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
      logger.info(`Checkpoint saved: ${workflowId}/${runId}`);
      return checkpoint;
    } catch (e) {
      logger.error(`Failed to save checkpoint: ${e.message}`);
      return null;
    }
  }

  static loadCheckpoint(workflowId, runId) {
    try {
      const filePath = CheckpointService._getCheckpointPath(workflowId, runId);
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
      logger.error(`Failed to load checkpoint: ${e.message}`);
      return null;
    }
  }

  static getLatestCheckpoint(workflowId) {
    try {
      const dir = path.join(CheckpointService._baseDir, workflowId);
      if (!fs.existsSync(dir)) return null;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
      if (files.length === 0) return null;
      const runId = files[0].replace('.json', '');
      return CheckpointService.loadCheckpoint(workflowId, runId);
    } catch (e) { return null; }
  }

  static listCheckpoints(workflowId) {
    try {
      const dir = path.join(CheckpointService._baseDir, workflowId);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
        const runId = f.replace('.json', '');
        const checkpoint = CheckpointService.loadCheckpoint(workflowId, runId);
        return { runId, timestamp: checkpoint?.timestamp, completedCount: Object.keys(checkpoint?.completedNodes || {}).length };
      });
    } catch (e) { return []; }
  }

  static deleteCheckpoint(workflowId, runId) {
    try {
      const filePath = CheckpointService._getCheckpointPath(workflowId, runId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    } catch (e) { return false; }
  }

  static deleteAllCheckpoints(workflowId) {
    try {
      const dir = path.join(CheckpointService._baseDir, workflowId);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
      return true;
    } catch (e) { return false; }
  }
}

module.exports = CheckpointService;
