"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger = require('../utils/logger');
class MemoryService {
    static _baseDir = null;
    static _cache = new Map();
    static _CACHE_TTL = 5000; // 5 seconds
    static init(workspaceRoot) {
        MemoryService._baseDir = path_1.default.join(workspaceRoot, '.context');
        if (!fs_1.default.existsSync(MemoryService._baseDir)) {
            fs_1.default.mkdirSync(MemoryService._baseDir, { recursive: true });
        }
        const sharedDir = path_1.default.join(MemoryService._baseDir, 'shared');
        if (!fs_1.default.existsSync(sharedDir)) {
            fs_1.default.mkdirSync(sharedDir, { recursive: true });
        }
    }
    static _getMemoryPath(workflowId) {
        if (!MemoryService._baseDir) {
            throw new Error('MemoryService not initialized');
        }
        if (!workflowId || typeof workflowId !== 'string')
            throw new Error('Invalid workflowId');
        if (workflowId.includes('..') || workflowId.includes('/') || workflowId.includes('\\')) {
            throw new Error('Path traversal detected');
        }
        // Only allow alphanumeric, hyphens, underscores
        if (!/^[a-zA-Z0-9_-]+$/.test(workflowId)) {
            throw new Error('Invalid workflowId format');
        }
        return path_1.default.join(MemoryService._baseDir, `${workflowId}.md`);
    }
    static getMemory(workflowId) {
        try {
            // Check cache first
            const cached = MemoryService._cache.get(workflowId);
            if (cached && (Date.now() - cached.ts) < MemoryService._CACHE_TTL) {
                return cached.content;
            }
            const filePath = MemoryService._getMemoryPath(workflowId);
            if (!fs_1.default.existsSync(filePath)) {
                MemoryService._cache.set(workflowId, { content: '', ts: Date.now() });
                return '';
            }
            const content = fs_1.default.readFileSync(filePath, 'utf-8');
            MemoryService._cache.set(workflowId, { content, ts: Date.now() });
            return content;
        }
        catch (e) {
            return '';
        }
    }
    static updateMemory(workflowId, content) {
        try {
            const filePath = MemoryService._getMemoryPath(workflowId);
            fs_1.default.writeFileSync(filePath, content, 'utf-8');
            // Invalidate cache
            MemoryService._cache.delete(workflowId);
            return true;
        }
        catch (e) {
            logger.error(`Failed to update memory: ${e.message}`);
            return false;
        }
    }
    static appendMemory(workflowId, entry) {
        let existing = MemoryService.getMemory(workflowId);
        const timestamp = new Date().toISOString();
        // Deduplication: check if the last session has very similar content
        if (existing && MemoryService._isDuplicate(existing, entry)) {
            return true; // Skip duplicate
        }
        const newEntry = `\n\n## Session ${timestamp}\n\n${entry}\n`;
        let content = existing + newEntry;
        // 压缩：超过 15000 字符时，保留最近 5 个会话，旧会话只保留标题
        if (content.length > 15000) {
            content = MemoryService._compressMemory(content);
        }
        return MemoryService.updateMemory(workflowId, content);
    }
    static appendMemoryWithTag(workflowId, entry, tag = '') {
        if (!workflowId || !entry)
            return false;
        let existing = MemoryService.getMemory(workflowId);
        const timestamp = new Date().toISOString();
        // Truncate tag to 50 chars to prevent header bloat
        const tagLabel = tag ? ` | ${String(tag).substring(0, 50).replace(/\n/g, ' ')}` : '';
        // Deduplication
        if (existing && MemoryService._isDuplicate(existing, entry)) {
            return true;
        }
        const newEntry = `\n\n## Session ${timestamp}${tagLabel}\n\n${entry}\n`;
        let content = existing + newEntry;
        // Compress if over 15000 chars
        if (content.length > 15000) {
            content = MemoryService._compressMemory(content);
        }
        return MemoryService.updateMemory(workflowId, content);
    }
    static extractAgentMemory(output) {
        if (!output)
            return [];
        const str = String(output);
        const memories = [];
        // Match [记忆: ...] or [Memory: ...] patterns
        const regex = /\[(记忆|Memory)\s*[:：]\s*([^\]]+)\]/gi;
        let match;
        while ((match = regex.exec(str)) !== null) {
            memories.push(match[2].trim());
        }
        return memories;
    }
    static injectMemoryFiltered(workflowId, taskInput) {
        const memory = MemoryService.getMemory(workflowId);
        if (!memory || memory.trim().length === 0)
            return '';
        // If no task input, inject all (up to limit)
        if (!taskInput || taskInput.trim().length === 0) {
            return `\n\n[Workflow Memory - Previous Sessions]\n${memory.substring(0, 10000)}\n`;
        }
        // Extract keywords from task input
        // Chinese: extract 2-char bigrams, filter out common suffixes
        // English: extract 3+ char words
        const commonSuffixes = new Set(['笔记', '任务', '工作', '处理', '生成', '编写', '创建', '整理', '分析', '检查', '修复', '运行', '执行', '测试']);
        const chinese = taskInput.match(/[一-鿿]+/g) || [];
        const english = taskInput.match(/[a-zA-Z]{3,}/g) || [];
        const keywords = [...english];
        for (const seg of chinese) {
            for (let i = 0; i < seg.length - 1; i++) {
                const bigram = seg.substring(i, i + 2);
                if (!commonSuffixes.has(bigram)) {
                    keywords.push(bigram);
                }
            }
        }
        if (keywords.length === 0) {
            return `\n\n[Workflow Memory - Previous Sessions]\n${memory.substring(0, 10000)}\n`;
        }
        // Split into sessions and filter by keyword match
        const sections = memory.split(/(?=## Session )/).filter(s => s.trim());
        const matched = sections.filter(section => {
            const sectionLower = section.toLowerCase();
            return keywords.some(kw => sectionLower.includes(kw.toLowerCase()));
        });
        if (matched.length === 0) {
            // No matching memory, inject nothing
            return '';
        }
        const filtered = matched.join('\n');
        return `\n\n[Workflow Memory - Previous Sessions]\n${filtered.substring(0, 10000)}\n`;
    }
    /**
     * Check if a new entry is substantially duplicate of the last session
     */
    static _isDuplicate(existing, newEntry) {
        try {
            // Extract last session content
            const sections = existing.split(/(?=## Session )/);
            if (sections.length === 0)
                return false;
            const lastSection = sections[sections.length - 1];
            // Remove the header line
            const lastContent = lastSection.replace(/^## Session[^\n]*\n/, '').trim();
            const newContent = newEntry.trim();
            if (!lastContent || !newContent)
                return false;
            // Fast path: exact match
            if (lastContent === newContent)
                return true;
            // Line-based similarity: check if 70%+ of lines overlap
            const lastLines = new Set(lastContent.split('\n').map(l => l.trim()).filter(l => l.length > 0));
            const newLines = newContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lastLines.size === 0 || newLines.length === 0)
                return false;
            let overlap = 0;
            for (const line of newLines) {
                if (lastLines.has(line))
                    overlap++;
            }
            return (overlap / newLines.length) > 0.7;
        }
        catch (e) {
            return false;
        }
    }
    static _compressMemory(content) {
        const sections = content.split(/(?=## Session )/);
        if (sections.length <= 5)
            return content;
        const recent = sections.slice(-5).join('');
        const old = sections.slice(0, -5);
        const compressedOld = old.map(s => {
            // Preserve the full header line including any | tag part
            const headerMatch = s.match(/^## Session\s+[^\n]*/);
            return headerMatch ? headerMatch[0] : '';
        }).filter(Boolean).join('\n');
        return compressedOld + '\n\n' + recent;
    }
    static getSharedPool() {
        try {
            if (!MemoryService._baseDir)
                return { variables: {}, notes: [], recentOutputs: {} };
            const filePath = path_1.default.join(MemoryService._baseDir, 'shared', 'pool.json');
            if (!fs_1.default.existsSync(filePath))
                return { variables: {}, notes: [], recentOutputs: {} };
            return JSON.parse(fs_1.default.readFileSync(filePath, 'utf-8'));
        }
        catch (e) {
            return { variables: {}, notes: [], recentOutputs: {} };
        }
    }
    static updateSharedPool(data) {
        try {
            if (!MemoryService._baseDir)
                return false;
            const filePath = path_1.default.join(MemoryService._baseDir, 'shared', 'pool.json');
            const existing = MemoryService.getSharedPool();
            const merged = { ...existing, ...data, lastUpdated: new Date().toISOString() };
            fs_1.default.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
            return true;
        }
        catch (e) {
            return false;
        }
    }
    /**
     * Extract a meaningful summary from agent output, filtering noise
     */
    static extractSummary(output) {
        if (!output)
            return '';
        const str = String(output);
        // Filter out noise lines
        const noisePatterns = [
            /^(Done|完成|OK|ok|Success|成功)[!！.。]*\s*$/i,
            /^已(创建|生成|写入|保存|修改|更新)/,
            /^(File|文件)\s+(created|saved|written)/i,
            /^\s*$/,
            /^```/, // code fences
            /^---+$/, // horizontal rules
        ];
        const lines = str.split('\n').filter(line => {
            return !noisePatterns.some(p => p.test(line.trim()));
        });
        // If filtered content is meaningful, use it; otherwise fall back to raw
        const filtered = lines.join('\n').trim();
        if (filtered.length > 100) {
            // Take first 300 chars (task context) + last 400 chars (conclusion)
            if (filtered.length > 700) {
                return filtered.substring(0, 300) + '\n...(省略)...\n' + filtered.slice(-400);
            }
            return filtered;
        }
        // Fallback: original logic with smaller window
        return str.length > 500 ? str.slice(-500) : str;
    }
    static injectMemory(workflowId) {
        const memory = MemoryService.getMemory(workflowId);
        if (!memory || memory.trim().length === 0)
            return '';
        return `\n\n[Workflow Memory - Previous Sessions]\n${memory.substring(0, 10000)}\n`;
    }
    static listMemories() {
        try {
            const result = [];
            if (!MemoryService._baseDir)
                return [];
            if (!fs_1.default.existsSync(MemoryService._baseDir))
                return [];
            for (const f of fs_1.default.readdirSync(MemoryService._baseDir)) {
                if (f.endsWith('.md')) {
                    const workflowId = f.replace('.md', '');
                    result.push({ workflowId, path: path_1.default.join(MemoryService._baseDir, f) });
                }
            }
            return result;
        }
        catch (e) {
            return [];
        }
    }
    static deleteMemory(workflowId) {
        try {
            const filePath = MemoryService._getMemoryPath(workflowId);
            if (fs_1.default.existsSync(filePath))
                fs_1.default.unlinkSync(filePath);
            MemoryService._cache.delete(workflowId);
            return true;
        }
        catch (e) {
            return false;
        }
    }
    /**
     * Clean up shared pool entries belonging to a specific workflow
     */
    static cleanSharedPool(workflowId) {
        try {
            const pool = MemoryService.getSharedPool();
            let changed = false;
            // Remove recentOutputs entries for this workflow
            if (pool.recentOutputs) {
                const prefix = workflowId + '_';
                for (const key of Object.keys(pool.recentOutputs)) {
                    if (key.startsWith(prefix) || key === workflowId) {
                        delete pool.recentOutputs[key];
                        changed = true;
                    }
                }
            }
            // Remove notes tagged with this workflow
            if (pool.notes && pool.notes.length > 0) {
                const before = pool.notes.length;
                pool.notes = pool.notes.filter(n => n.workflowId !== workflowId);
                if (pool.notes.length !== before)
                    changed = true;
            }
            if (changed) {
                pool.lastUpdated = new Date().toISOString();
                MemoryService.updateSharedPool(pool);
            }
            return true;
        }
        catch (e) {
            return false;
        }
    }
    /**
     * Archive is disabled — memory is now append-only with task tags.
     * This method is a no-op to prevent destructive memory loss.
     */
    static archiveMemory(_workflowId) {
        // No-op: memory is append-only, no archiving needed
        return true;
    }
    // Backward compatibility: old agent+workflow scoped methods redirect to workflow-only
    static getMemoryLegacy(_agentId, workflowId) {
        return MemoryService.getMemory(workflowId);
    }
    static appendMemoryLegacy(_agentId, workflowId, entry) {
        return MemoryService.appendMemory(workflowId, entry);
    }
    static injectMemoryLegacy(_agentId, workflowId) {
        return MemoryService.injectMemory(workflowId);
    }
}
module.exports = MemoryService;
//# sourceMappingURL=MemoryService.js.map