import fs from 'fs';
import path from 'path';

const logger = require('../utils/logger');

// Types
interface CompletedNode {
  status: string;
  output: string;
  startedAt?: string;
  completedAt?: string;
  duration?: number | null;
  model?: string | null;
  tokens?: number | null;
  error?: string | null;
}

interface CheckpointData {
  completedNodes?: Record<string, CompletedNode | string>;
  pendingNodes?: string[];
  nodeOutputs?: Record<string, any>;
  workflowInput?: any;
  executionContext?: Record<string, any>;
  summary?: string | null;
  totalTokens?: number | null;
  startedAt?: string;
  completedAt?: string | null;
  duration?: number | null;
}

interface Checkpoint {
  workflowId: string;
  runId: string;
  timestamp: string;
  startedAt: string;
  completedAt: string | null;
  duration: number | null;
  completedNodes: Record<string, CompletedNode>;
  pendingNodes: string[];
  nodeOutputs: Record<string, any>;
  workflowInput: any;
  executionContext: Record<string, any>;
  summary: string | null;
  totalTokens: number | null;
}

interface CheckpointListItem {
  runId: string;
  timestamp: string;
  completedCount: number;
}

class CheckpointService {
  static _baseDir: string | null = null;

  static init(workspaceRoot: string): void {
    CheckpointService._baseDir = path.join(workspaceRoot, 'WORKFLOWS', 'checkpoints');
    if (!fs.existsSync(CheckpointService._baseDir)) {
      fs.mkdirSync(CheckpointService._baseDir, { recursive: true });
    }
  }

  static _getCheckpointPath(workflowId: string, runId: string): string {
    if (!CheckpointService._baseDir) {
      throw new Error('CheckpointService not initialized');
    }
    if (!workflowId || !runId) throw new Error('Invalid workflowId or runId');
    if (workflowId.includes('..') || runId.includes('..')) throw new Error('Path traversal detected');
    const dir = path.join(CheckpointService._baseDir, workflowId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${runId}.json`);
  }

  static saveCheckpoint(workflowId: string, runId: string, data: CheckpointData): Checkpoint | null {
    try {
      const filePath = CheckpointService._getCheckpointPath(workflowId, runId);
      const now = new Date().toISOString();

      // Enhance completedNodes with metadata if provided
      const completedNodes: Record<string, CompletedNode> = {};
      for (const [nodeId, nodeData] of Object.entries(data.completedNodes || {})) {
        if (typeof nodeData === 'object' && nodeData !== null) {
          const nd = nodeData as CompletedNode;
          completedNodes[nodeId] = {
            status: nd.status || 'completed',
            output: nd.output || '',
            startedAt: nd.startedAt || now,
            completedAt: nd.completedAt || now,
            duration: nd.duration || null,
            model: nd.model || null,
            tokens: nd.tokens || null,
            error: nd.error || null
          };
        } else {
          // Legacy format: just status string
          completedNodes[nodeId] = { status: nodeData as string, output: '' };
        }
      }

      const checkpoint: Checkpoint = {
        workflowId,
        runId,
        timestamp: now,
        startedAt: data.startedAt || now,
        completedAt: data.completedAt || null,
        duration: data.duration || null,
        completedNodes,
        pendingNodes: data.pendingNodes || [],
        nodeOutputs: data.nodeOutputs || {},
        workflowInput: data.workflowInput || null,
        executionContext: data.executionContext || {},
        summary: data.summary || null,
        totalTokens: data.totalTokens || null
      };
      fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
      logger.info(`Checkpoint saved: ${workflowId}/${runId}`);
      return checkpoint;
    } catch (e: any) {
      logger.error(`Failed to save checkpoint: ${e.message}`);
      return null;
    }
  }

  static loadCheckpoint(workflowId: string, runId: string): Checkpoint | null {
    try {
      const filePath = CheckpointService._getCheckpointPath(workflowId, runId);
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e: any) {
      logger.error(`Failed to load checkpoint: ${e.message}`);
      return null;
    }
  }

  static getLatestCheckpoint(workflowId: string): Checkpoint | null {
    try {
      if (!CheckpointService._baseDir) return null;
      const dir = path.join(CheckpointService._baseDir, workflowId);
      if (!fs.existsSync(dir)) return null;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
      if (files.length === 0) return null;
      const runId = files[0].replace('.json', '');
      return CheckpointService.loadCheckpoint(workflowId, runId);
    } catch (e) { return null; }
  }

  static listCheckpoints(workflowId: string): CheckpointListItem[] {
    try {
      if (!CheckpointService._baseDir) return [];
      const dir = path.join(CheckpointService._baseDir, workflowId);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
        const runId = f.replace('.json', '');
        const checkpoint = CheckpointService.loadCheckpoint(workflowId, runId);
        return { runId, timestamp: checkpoint?.timestamp || '', completedCount: Object.keys(checkpoint?.completedNodes || {}).length };
      });
    } catch (e) { return []; }
  }

  static deleteCheckpoint(workflowId: string, runId: string): boolean {
    try {
      const filePath = CheckpointService._getCheckpointPath(workflowId, runId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    } catch (e) { return false; }
  }

  static deleteAllCheckpoints(workflowId: string): boolean {
    try {
      if (!CheckpointService._baseDir) return false;
      const dir = path.join(CheckpointService._baseDir, workflowId);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
      return true;
    } catch (e) { return false; }
  }
}

module.exports = CheckpointService;
