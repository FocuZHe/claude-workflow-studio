"use strict";
/**
 * WorkspaceStateService - 工作区状态服务
 * 管理工作区状态持久化
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceStateService = void 0;
const logger = require('../utils/logger');
class WorkspaceStateService {
    static states = new Map();
    /**
     * 确保工作流文件夹存在，并创建所有必要的目录和文件
     * 按照架构文档要求创建完整的目录结构
     */
    static ensureWorkflowsFolder(workspacePath) {
        const fs = require('fs');
        const path = require('path');
        try {
            // 创建主目录结构
            const dirs = [
                'WORKFLOWS',
                'WORKFLOWS/.checkpoint',
                'WORKFLOWS/snapshots',
                'reports',
                '.context',
                '.context/shared',
                '.BACKUP'
            ];
            for (const dir of dirs) {
                const fullPath = path.join(workspacePath, dir);
                if (!fs.existsSync(fullPath)) {
                    fs.mkdirSync(fullPath, { recursive: true });
                }
            }
            // 创建必要的JSON文件（如果不存在）
            const jsonFiles = {
                'WORKFLOWS/workflows.json': [],
                'WORKFLOWS/knowledge.json': [],
                'WORKFLOWS/tags.json': [],
                'WORKFLOWS/artifact-index.json': [],
                'WORKFLOWS/chat-sessions.json': [],
                'WORKFLOWS/prompt-templates.json': [],
                'WORKFLOWS/skills.json': [],
                'WORKFLOWS/mcp-tools.json': [],
                'WORKFLOWS/execution-log.json': []
            };
            for (const [filePath, defaultData] of Object.entries(jsonFiles)) {
                const fullPath = path.join(workspacePath, filePath);
                if (!fs.existsSync(fullPath)) {
                    fs.writeFileSync(fullPath, JSON.stringify(defaultData, null, 2), 'utf-8');
                }
            }
            // 创建共享池文件
            const poolPath = path.join(workspacePath, '.context', 'shared', 'pool.json');
            if (!fs.existsSync(poolPath)) {
                fs.writeFileSync(poolPath, JSON.stringify({ variables: {}, notes: [] }, null, 2), 'utf-8');
            }
            logger.info(`工作区目录结构已初始化: ${workspacePath}`);
        }
        catch (e) {
            logger.error(`初始化工作区目录失败: ${e.message}`);
        }
    }
    /**
     * 加载状态
     */
    static loadState(workspacePath) {
        const fs = require('fs');
        const path = require('path');
        try {
            const workflowsPath = path.join(workspacePath, 'WORKFLOWS', 'workflows.json');
            const manifestPath = path.join(workspacePath, 'WORKFLOWS', 'manifest.json');
            let workflows = [];
            let manifest = {};
            // Load workflows
            if (fs.existsSync(workflowsPath)) {
                const data = JSON.parse(fs.readFileSync(workflowsPath, 'utf-8'));
                workflows = Array.isArray(data) ? data : [];
            }
            // Load manifest
            if (fs.existsSync(manifestPath)) {
                manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            }
            return {
                workspaceId: manifest.workspaceId || path.basename(workspacePath),
                workspacePath,
                workflows,
                manifest,
                agents: [],
                updatedAt: new Date()
            };
        }
        catch (e) {
            logger.warn(`Failed to load workspace state: ${e.message}`);
            return null;
        }
    }
    /**
     * 保存状态
     */
    static saveState(state) {
        this.states.set(state.workspaceId, state);
    }
    /**
     * 获取状态
     */
    static getState(workspaceId) {
        return this.states.get(workspaceId);
    }
    /**
     * 获取历史记录
     */
    static getHistory() {
        return Array.from(this.states.values());
    }
    /**
     * 更新历史记录
     */
    static updateHistory(workspacePath) {
        const fs = require('fs');
        const path = require('path');
        try {
            const workspaceId = path.basename(workspacePath);
            const existing = this.states.get(workspaceId);
            if (existing) {
                existing.updatedAt = new Date();
            }
            else {
                const state = {
                    workspaceId,
                    path: workspacePath,
                    name: workspaceId,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
                this.states.set(workspaceId, state);
            }
        }
        catch (e) {
            // Silent fail
        }
    }
    /**
     * 备份工作流文件夹
     */
    static backupWorkflowsFolder(workspacePath) {
        const fs = require('fs');
        const path = require('path');
        const workflowsDir = path.join(workspacePath, 'WORKFLOWS');
        const backupDir = path.join(workspacePath, '.BACKUP', 'WORKFLOWS');
        if (!fs.existsSync(workflowsDir))
            return;
        try {
            if (!fs.existsSync(path.join(workspacePath, '.BACKUP'))) {
                fs.mkdirSync(path.join(workspacePath, '.BACKUP'), { recursive: true });
            }
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            const entries = fs.readdirSync(workflowsDir);
            for (const entry of entries) {
                const src = path.join(workflowsDir, entry);
                const dest = path.join(backupDir, entry);
                if (fs.statSync(src).isFile()) {
                    fs.copyFileSync(src, dest);
                }
            }
        }
        catch (e) {
            // Silent fail for backup
        }
    }
    /**
     * 恢复工作流文件夹
     */
    static restoreWorkflowsFolder(workspacePath) {
        const fs = require('fs');
        const path = require('path');
        const backupDir = path.join(workspacePath, '.BACKUP', 'WORKFLOWS');
        const workflowsDir = path.join(workspacePath, 'WORKFLOWS');
        if (!fs.existsSync(backupDir))
            return false;
        try {
            if (!fs.existsSync(workflowsDir)) {
                fs.mkdirSync(workflowsDir, { recursive: true });
            }
            const entries = fs.readdirSync(backupDir);
            for (const entry of entries) {
                const src = path.join(backupDir, entry);
                const dest = path.join(workflowsDir, entry);
                if (fs.statSync(src).isFile()) {
                    fs.copyFileSync(src, dest);
                }
            }
            return true;
        }
        catch (e) {
            return false;
        }
    }
}
exports.WorkspaceStateService = WorkspaceStateService;
module.exports = WorkspaceStateService;
//# sourceMappingURL=WorkspaceStateService.js.map