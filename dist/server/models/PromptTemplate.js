"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require('path');
const fs = require('fs');
const { generateId } = require('../utils/id');
const config = require('../config');
const DataStore = require('../utils/DataStore');
const { atomicWriteSync, atomicWriteAsync } = require('../utils/atomicWrite');
// DataStore for persistence
const dataStore = new DataStore(path.join(config.data.dir, config.data.promptTemplatesFile));
// In-memory store, loaded from file on startup
const promptTemplates = new Map();
const savedTemplates = dataStore.load();
savedTemplates.forEach((template) => {
    promptTemplates.set(template.id, template);
});
/**
 * PromptTemplate Model - In-memory CRUD operations
 */
class PromptTemplateModel {
    static _persistPending = false;
    static create(data) {
        const now = new Date();
        const template = {
            id: generateId(),
            name: data.name,
            content: data.content,
            description: data.description || '',
            category: data.category || 'general',
            variables: data.variables || [],
            preset: data.preset === true,
            workspaceId: data.workspaceId !== undefined ? data.workspaceId : null,
            usageCount: 0,
            createdAt: now,
            updatedAt: now
        };
        promptTemplates.set(template.id, template);
        this._persist();
        return { ...template };
    }
    static findAll({ category, search, page = 1, limit = 20 } = {}) {
        let results = Array.from(promptTemplates.values());
        if (category)
            results = results.filter((t) => t.category === category);
        if (search) {
            const q = search.toLowerCase();
            results = results.filter((t) => t.name.toLowerCase().includes(q) ||
                t.description.toLowerCase().includes(q));
        }
        results.sort((a, b) => {
            if (b.usageCount !== a.usageCount)
                return b.usageCount - a.usageCount;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
        const total = results.length;
        const start = (page - 1) * limit;
        const paginated = results.slice(start, start + limit);
        return {
            items: paginated.map((t) => ({ ...t })),
            total,
            page,
            limit
        };
    }
    static findById(id) {
        const template = promptTemplates.get(id);
        return template ? { ...template } : null;
    }
    static update(id, data) {
        const template = promptTemplates.get(id);
        if (!template)
            return null;
        if (template.preset)
            return { error: 'PRESET_READONLY', message: '预设模板不可编辑' };
        if (data.name !== undefined)
            template.name = data.name;
        if (data.content !== undefined)
            template.content = data.content;
        if (data.description !== undefined)
            template.description = data.description;
        if (data.category !== undefined)
            template.category = data.category;
        if (data.variables !== undefined)
            template.variables = data.variables;
        template.updatedAt = new Date();
        this._persist();
        return { ...template };
    }
    static delete(id) {
        const template = promptTemplates.get(id);
        if (!template)
            return false;
        if (template.preset)
            return { error: 'PRESET_READONLY', message: '预设模板不可删除' };
        promptTemplates.delete(id);
        this._persist();
        return true;
    }
    static incrementUsage(id) {
        const template = promptTemplates.get(id);
        if (!template)
            return null;
        template.usageCount += 1;
        template.updatedAt = new Date();
        this._persist();
        return { ...template };
    }
    static exists(id) {
        return promptTemplates.has(id);
    }
    static findByName(name) {
        for (const template of promptTemplates.values()) {
            if (template.name === name)
                return { ...template };
        }
        return null;
    }
    static _persist() {
        if (this._persistPending)
            return;
        this._persistPending = true;
        setImmediate(() => {
            this._doPersist();
        });
    }
    static _flush() {
        if (!this._persistPending)
            return;
        this._persistPending = false;
        this._doPersistSync();
    }
    static async _doPersist() {
        this._persistPending = false;
        const data = Array.from(promptTemplates.values());
        try {
            dataStore.saveAsync(data);
        }
        catch (e) {
            const logger = require('../utils/logger');
            logger.error(`Failed to persist prompt templates: ${e.message}`);
        }
    }
    static _doPersistSync() {
        this._persistPending = false;
        try {
            dataStore.save(Array.from(promptTemplates.values()));
        }
        catch (e) {
            const logger = require('../utils/logger');
            logger.error(`Failed to persist prompt templates: ${e.message}`);
        }
    }
    static clear() {
        promptTemplates.clear();
    }
    static reload(templateArray) {
        if (!Array.isArray(templateArray))
            return;
        for (const template of templateArray) {
            if (template && template.id) {
                promptTemplates.set(template.id, template);
            }
        }
    }
    static count() {
        return promptTemplates.size;
    }
}
PromptTemplateModel._persistPending = false;
module.exports = PromptTemplateModel;
//# sourceMappingURL=PromptTemplate.js.map