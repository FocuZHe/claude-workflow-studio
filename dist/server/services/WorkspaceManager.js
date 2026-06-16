"use strict";
/**
 * WorkspaceManager - 工作区管理器
 * 管理多个工作区，支持持久化
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceManager = void 0;
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
// 持久化文件路径
const PERSIST_FILE = path.join(process.cwd(), 'data', 'active-workspaces.json');
class WorkspaceManager extends EventEmitter {
    static _workspaces = new Map();
    static _initialized = false;
    /**
     * 初始化（启动时调用，恢复持久化的工作区）
     */
    static init() {
        if (this._initialized)
            return;
        this._initialized = true;
        this.restoreAll();
    }
    /**
     * 获取所有活跃工作区（返回数组）
     */
    static getActive() {
        this.init();
        return Array.from(this._workspaces.values());
    }
    /**
     * 获取第一个活跃工作区
     */
    static getFirstActive() {
        this.init();
        const workspaces = Array.from(this._workspaces.values());
        return workspaces.length > 0 ? workspaces[0] : null;
    }
    /**
     * 根据路径查找工作区
     */
    static findByPath(wsPath) {
        if (!wsPath)
            return undefined;
        this.init();
        const resolved = path.resolve(wsPath);
        for (const ws of this._workspaces.values()) {
            if (ws.path === resolved)
                return ws;
        }
        return undefined;
    }
    /**
     * 获取工作区
     */
    static getById(workspaceId) {
        this.init();
        return this._workspaces.get(workspaceId);
    }
    /**
     * 获取所有工作区
     */
    static getAll() {
        this.init();
        return Array.from(this._workspaces.values());
    }
    /**
     * 添加工作区（带持久化）
     */
    static addWorkspace(workspace) {
        this._workspaces.set(workspace.id, workspace);
        this._persist();
    }
    /**
     * 激活工作区（如果已存在则更新，否则创建）
     */
    static activate(wsPath) {
        this.init();
        const resolved = path.resolve(wsPath);
        const existing = this.findByPath(resolved);
        if (existing) {
            existing.activatedAt = new Date();
            this._persist();
            return existing;
        }
        const id = `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const name = path.basename(resolved);
        const workspace = {
            id,
            path: resolved,
            name,
            activatedAt: new Date(),
            workflowData: [],
            agentData: []
        };
        this._workspaces.set(id, workspace);
        this._persist();
        // 更新工作区文件中的 workspaceId，使其与新 ID 匹配
        this._updateWorkspaceIds(resolved, id);
        logger.info(`Workspace activated: ${resolved} (id: ${id})`);
        return workspace;
    }
    /**
     * 更新工作区文件中的 workspaceId（工作流和聊天记录）
     */
    static _updateWorkspaceIds(wsPath, newWsId) {
        try {
            const workflowsDir = path.join(wsPath, 'WORKFLOWS');
            if (!fs.existsSync(workflowsDir))
                return;
            // 需要更新 workspaceId 的文件
            const filesToUpdate = ['workflows.json', 'chat-sessions.json'];
            for (const fileName of filesToUpdate) {
                const filePath = path.join(workflowsDir, fileName);
                if (!fs.existsSync(filePath))
                    continue;
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    if (!Array.isArray(data) || data.length === 0)
                        continue;
                    let updated = false;
                    const updatedData = data.map((item) => {
                        if (item.workspaceId && item.workspaceId !== newWsId) {
                            updated = true;
                            return { ...item, workspaceId: newWsId };
                        }
                        return item;
                    });
                    if (updated) {
                        fs.writeFileSync(filePath, JSON.stringify(updatedData, null, 2), 'utf-8');
                        logger.info(`Updated workspaceId for ${updatedData.length} item(s) in ${fileName}`);
                    }
                }
                catch (e) {
                    logger.warn(`Failed to update ${fileName}: ${e.message}`);
                }
            }
            // 创建/更新 manifest 文件
            const manifestPath = path.join(workflowsDir, 'manifest.json');
            const manifest = { workspaceId: newWsId, updatedAt: new Date().toISOString() };
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
        }
        catch (e) {
            logger.warn(`Failed to update workspace IDs: ${e.message}`);
        }
    }
    /**
     * 删除工作区（带持久化）
     */
    static removeWorkspace(workspaceId) {
        const result = this._workspaces.delete(workspaceId);
        if (result)
            this._persist();
        return result;
    }
    /**
     * 获取指定工作区的工作流列表（从文件系统读取，不切换工作区）
     */
    static getWorkflowsForWorkspace(workspaceId) {
        const ws = this._workspaces.get(workspaceId);
        if (!ws)
            return [];
        try {
            const wfPath = path.join(ws.path, 'WORKFLOWS', 'workflows.json');
            if (fs.existsSync(wfPath)) {
                const data = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
                return Array.isArray(data) ? data : [];
            }
        }
        catch (e) {
            logger.warn(`Failed to load workflows for workspace ${workspaceId}:`, e.message);
        }
        return [];
    }
    /**
     * 恢复所有工作区（从持久化文件）
     */
    static restoreAll() {
        try {
            if (!fs.existsSync(PERSIST_FILE)) {
                logger.info('No persisted workspaces found');
                return;
            }
            const data = JSON.parse(fs.readFileSync(PERSIST_FILE, 'utf-8'));
            if (!Array.isArray(data))
                return;
            let restored = 0;
            for (const ws of data) {
                // 验证工作区路径是否存在
                if (ws.path && fs.existsSync(ws.path)) {
                    this._workspaces.set(ws.id, {
                        ...ws,
                        activatedAt: new Date(ws.activatedAt)
                    });
                    restored++;
                }
            }
            logger.info(`Restored ${restored} workspaces from persistence`);
        }
        catch (e) {
            logger.warn('Failed to restore workspaces:', e.message);
        }
    }
    /**
     * 持久化工作区列表到文件
     */
    static _persist() {
        try {
            const dir = path.dirname(PERSIST_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const data = Array.from(this._workspaces.values());
            fs.writeFileSync(PERSIST_FILE, JSON.stringify(data, null, 2), 'utf-8');
        }
        catch (e) {
            logger.warn('Failed to persist workspaces:', e.message);
        }
    }
    /**
     * 检查工作区是否有效（路径存在）
     */
    static isValid(workspaceId) {
        const ws = this._workspaces.get(workspaceId);
        if (!ws)
            return false;
        return fs.existsSync(ws.path);
    }
    /**
     * 停用工作区
     */
    static deactivate(workspaceId) {
        return this.removeWorkspace(workspaceId);
    }
    /**
     * 清理无效工作区（路径不存在的）
     */
    static cleanup() {
        let cleaned = 0;
        for (const [id, ws] of this._workspaces.entries()) {
            if (!fs.existsSync(ws.path)) {
                this._workspaces.delete(id);
                cleaned++;
            }
        }
        if (cleaned > 0)
            this._persist();
        return cleaned;
    }
}
exports.WorkspaceManager = WorkspaceManager;
module.exports = WorkspaceManager;
//# sourceMappingURL=WorkspaceManager.js.map