"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger = require('../utils/logger');
class CheckpointService {
    static _baseDir = null;
    static init(workspaceRoot) {
        CheckpointService._baseDir = path_1.default.join(workspaceRoot, 'WORKFLOWS', 'checkpoints');
        if (!fs_1.default.existsSync(CheckpointService._baseDir)) {
            fs_1.default.mkdirSync(CheckpointService._baseDir, { recursive: true });
        }
    }
    static _getCheckpointPath(workflowId, runId) {
        if (!CheckpointService._baseDir) {
            throw new Error('CheckpointService not initialized');
        }
        if (!workflowId || !runId)
            throw new Error('Invalid workflowId or runId');
        if (workflowId.includes('..') || runId.includes('..'))
            throw new Error('Path traversal detected');
        const dir = path_1.default.join(CheckpointService._baseDir, workflowId);
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
        return path_1.default.join(dir, `${runId}.json`);
    }
    static saveCheckpoint(workflowId, runId, data) {
        try {
            const filePath = CheckpointService._getCheckpointPath(workflowId, runId);
            const now = new Date().toISOString();
            // Enhance completedNodes with metadata if provided
            const completedNodes = {};
            for (const [nodeId, nodeData] of Object.entries(data.completedNodes || {})) {
                if (typeof nodeData === 'object' && nodeData !== null) {
                    const nd = nodeData;
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
                }
                else {
                    // Legacy format: just status string
                    completedNodes[nodeId] = { status: nodeData, output: '' };
                }
            }
            const checkpoint = {
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
            fs_1.default.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
            logger.info(`Checkpoint saved: ${workflowId}/${runId}`);
            return checkpoint;
        }
        catch (e) {
            logger.error(`Failed to save checkpoint: ${e.message}`);
            return null;
        }
    }
    static loadCheckpoint(workflowId, runId) {
        try {
            const filePath = CheckpointService._getCheckpointPath(workflowId, runId);
            if (!fs_1.default.existsSync(filePath))
                return null;
            return JSON.parse(fs_1.default.readFileSync(filePath, 'utf-8'));
        }
        catch (e) {
            logger.error(`Failed to load checkpoint: ${e.message}`);
            return null;
        }
    }
    static getLatestCheckpoint(workflowId) {
        try {
            if (!CheckpointService._baseDir)
                return null;
            const dir = path_1.default.join(CheckpointService._baseDir, workflowId);
            if (!fs_1.default.existsSync(dir))
                return null;
            const files = fs_1.default.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
            if (files.length === 0)
                return null;
            const runId = files[0].replace('.json', '');
            return CheckpointService.loadCheckpoint(workflowId, runId);
        }
        catch (e) {
            return null;
        }
    }
    static listCheckpoints(workflowId) {
        try {
            if (!CheckpointService._baseDir)
                return [];
            const dir = path_1.default.join(CheckpointService._baseDir, workflowId);
            if (!fs_1.default.existsSync(dir))
                return [];
            return fs_1.default.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
                const runId = f.replace('.json', '');
                const checkpoint = CheckpointService.loadCheckpoint(workflowId, runId);
                return { runId, timestamp: checkpoint?.timestamp || '', completedCount: Object.keys(checkpoint?.completedNodes || {}).length };
            });
        }
        catch (e) {
            return [];
        }
    }
    static deleteCheckpoint(workflowId, runId) {
        try {
            const filePath = CheckpointService._getCheckpointPath(workflowId, runId);
            if (fs_1.default.existsSync(filePath))
                fs_1.default.unlinkSync(filePath);
            return true;
        }
        catch (e) {
            return false;
        }
    }
    static deleteAllCheckpoints(workflowId) {
        try {
            if (!CheckpointService._baseDir)
                return false;
            const dir = path_1.default.join(CheckpointService._baseDir, workflowId);
            if (fs_1.default.existsSync(dir))
                fs_1.default.rmSync(dir, { recursive: true });
            return true;
        }
        catch (e) {
            return false;
        }
    }
}
module.exports = CheckpointService;
//# sourceMappingURL=CheckpointService.js.map