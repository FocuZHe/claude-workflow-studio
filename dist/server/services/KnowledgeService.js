"use strict";
/**
 * KnowledgeService - 知识库服务
 * 管理知识库条目，支持本地持久化
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeService = void 0;
const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('../utils/atomicWrite');
const logger = require('../utils/logger');
class KnowledgeService {
    // _index 为数组（测试直接赋值清空）
    static _index = [];
    static _initialized = false;
    static _persistPath = '';
    /**
     * 初始化服务，加载持久化数据
     */
    static init(workspacePath) {
        this._persistPath = path.join(workspacePath, 'WORKFLOWS', 'knowledge.json');
        this._load();
        this._initialized = true;
    }
    /**
     * 从磁盘加载数据
     */
    static _load() {
        try {
            if (!this._persistPath || !fs.existsSync(this._persistPath))
                return;
            const data = JSON.parse(fs.readFileSync(this._persistPath, 'utf-8'));
            if (Array.isArray(data)) {
                this._index = [];
                for (const entry of data) {
                    if (entry && entry.id) {
                        // 恢复 Date 对象
                        entry.createdAt = new Date(entry.createdAt);
                        entry.updatedAt = new Date(entry.updatedAt);
                        this._index.push(entry);
                    }
                }
                logger.info(`Loaded ${this._index.length} knowledge entries from disk`);
            }
        }
        catch (e) {
            logger.warn(`Failed to load knowledge data: ${e.message}`);
        }
    }
    /**
     * 持久化到磁盘
     */
    static _persist() {
        try {
            if (!this._persistPath)
                return;
            const dir = path.dirname(this._persistPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            atomicWriteSync(this._persistPath, JSON.stringify(this._index, null, 2));
        }
        catch (e) {
            logger.error(`Failed to persist knowledge data: ${e.message}`);
        }
    }
    /**
     * 添加知识条目
     */
    static addEntry(title, content, category, tags = [], source = 'manual') {
        const entry = {
            id: Math.random().toString(36).substring(7),
            title,
            content,
            category,
            tags,
            source,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this._index.push(entry);
        this._persist();
        return entry;
    }
    /**
     * 更新知识条目
     */
    static updateEntry(entryId, updates) {
        const entry = this._index.find(e => e.id === entryId);
        if (!entry)
            return null;
        if (updates.title !== undefined)
            entry.title = updates.title;
        if (updates.content !== undefined)
            entry.content = updates.content;
        if (updates.category !== undefined)
            entry.category = updates.category;
        if (updates.tags !== undefined)
            entry.tags = updates.tags;
        if (updates.source !== undefined)
            entry.source = updates.source;
        entry.updatedAt = new Date();
        this._persist();
        return entry;
    }
    /**
     * 删除知识条目
     */
    static deleteEntry(entryId) {
        const idx = this._index.findIndex(e => e.id === entryId);
        if (idx === -1)
            return false;
        this._index.splice(idx, 1);
        this._persist();
        return true;
    }
    /**
     * 获取知识条目
     */
    static getEntry(entryId) {
        return this._index.find(e => e.id === entryId);
    }
    /**
     * 搜索知识条目（支持 query/category/tag/page/limit，返回 { items, total }）
     */
    static search(query, options) {
        let results = this._index.slice();
        if (options?.category) {
            results = results.filter(entry => entry.category === options.category);
        }
        if (options?.tag) {
            results = results.filter(entry => Array.isArray(entry.tags) && entry.tags.includes(options.tag));
        }
        if (query) {
            const q = query.toLowerCase();
            results = results.filter(entry => (entry.title || '').toLowerCase().includes(q) || (entry.content || '').toLowerCase().includes(q));
        }
        // 按更新时间倒序
        results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        const total = results.length;
        const page = options?.page || 1;
        const limit = options?.limit || 20;
        const start = (page - 1) * limit;
        const items = results.slice(start, start + limit);
        return { items, total };
    }
    /**
     * 获取所有知识条目
     */
    static getAll() {
        return this._index.slice();
    }
    /**
     * 清空（用于工作区切换）
     */
    static clear() {
        this._index = [];
    }
    /**
     * 重新加载数据
     */
    static reload(entries) {
        if (!Array.isArray(entries))
            return;
        this._index = [];
        for (const entry of entries) {
            if (entry && entry.id) {
                this._index.push(entry);
            }
        }
    }
    // ── 兼容路由调用的别名方法 ──
    /**
     * 添加条目（兼容路由调用，从 body 提取字段）
     */
    static add(data) {
        return this.addEntry(data.title || '', data.content || '', data.category || 'general', Array.isArray(data.tags) ? data.tags : [], data.source || 'manual');
    }
    /**
     * 更新条目（兼容路由调用）
     */
    static update(entryId, data) {
        return this.updateEntry(entryId, data);
    }
    /**
     * 删除条目（兼容路由调用）
     */
    static delete(entryId) {
        return this.deleteEntry(entryId);
    }
}
exports.KnowledgeService = KnowledgeService;
module.exports = KnowledgeService;
//# sourceMappingURL=KnowledgeService.js.map