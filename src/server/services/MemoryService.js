const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class MemoryService {
  static _baseDir = null;
  static _cache = new Map(); // workflowId -> { content, ts }
  static _CACHE_TTL = 5000; // 5 seconds

  static init(workspaceRoot) {
    MemoryService._baseDir = path.join(workspaceRoot, '.context');
    if (!fs.existsSync(MemoryService._baseDir)) {
      fs.mkdirSync(MemoryService._baseDir, { recursive: true });
    }
    const sharedDir = path.join(MemoryService._baseDir, 'shared');
    if (!fs.existsSync(sharedDir)) {
      fs.mkdirSync(sharedDir, { recursive: true });
    }
  }

  static _getMemoryPath(workflowId) {
    if (!workflowId) throw new Error('Invalid workflowId');
    if (workflowId.includes('..')) throw new Error('Path traversal detected');
    return path.join(MemoryService._baseDir, `${workflowId}.md`);
  }

  static getMemory(workflowId) {
    try {
      // Check cache first
      const cached = MemoryService._cache.get(workflowId);
      if (cached && (Date.now() - cached.ts) < MemoryService._CACHE_TTL) {
        return cached.content;
      }
      const filePath = MemoryService._getMemoryPath(workflowId);
      if (!fs.existsSync(filePath)) {
        MemoryService._cache.set(workflowId, { content: '', ts: Date.now() });
        return '';
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      MemoryService._cache.set(workflowId, { content, ts: Date.now() });
      return content;
    } catch (e) { return ''; }
  }

  static updateMemory(workflowId, content) {
    try {
      const filePath = MemoryService._getMemoryPath(workflowId);
      fs.writeFileSync(filePath, content, 'utf-8');
      // Invalidate cache
      MemoryService._cache.delete(workflowId);
      return true;
    } catch (e) {
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

  /**
   * Check if a new entry is substantially duplicate of the last session
   */
  static _isDuplicate(existing, newEntry) {
    try {
      // Extract last session content
      const sections = existing.split(/(?=## Session )/);
      if (sections.length === 0) return false;
      const lastSection = sections[sections.length - 1];
      // Remove the header line
      const lastContent = lastSection.replace(/^## Session[^\n]*\n/, '').trim();
      const newContent = newEntry.trim();

      if (!lastContent || !newContent) return false;

      // Simple similarity: check if 70%+ of lines overlap
      const lastLines = new Set(lastContent.split('\n').map(l => l.trim()).filter(l => l.length > 10));
      const newLines = newContent.split('\n').map(l => l.trim()).filter(l => l.length > 10);
      if (lastLines.size === 0 || newLines.length === 0) return false;

      let overlap = 0;
      for (const line of newLines) {
        if (lastLines.has(line)) overlap++;
      }
      return (overlap / newLines.length) > 0.7;
    } catch (e) { return false; }
  }

  static _compressMemory(content) {
    const sections = content.split(/(?=## Session )/);
    if (sections.length <= 5) return content;

    const recent = sections.slice(-5).join('');
    const old = sections.slice(0, -5);

    const compressedOld = old.map(s => {
      const lines = s.split('\n');
      const header = lines.find(l => l.startsWith('## Session')) || '';
      return header;
    }).filter(Boolean).join('\n');

    return compressedOld + '\n\n' + recent;
  }

  static getSharedPool() {
    try {
      const filePath = path.join(MemoryService._baseDir, 'shared', 'pool.json');
      if (!fs.existsSync(filePath)) return { variables: {}, notes: [], recentOutputs: {} };
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) { return { variables: {}, notes: [], recentOutputs: {} }; }
  }

  static updateSharedPool(data) {
    try {
      const filePath = path.join(MemoryService._baseDir, 'shared', 'pool.json');
      const existing = MemoryService.getSharedPool();
      const merged = { ...existing, ...data, lastUpdated: new Date().toISOString() };
      fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
      return true;
    } catch (e) { return false; }
  }

  /**
   * Extract a meaningful summary from agent output, filtering noise
   */
  static extractSummary(output) {
    if (!output) return '';
    const str = String(output);

    // Filter out noise lines
    const noisePatterns = [
      /^(Done|完成|OK|ok|Success|成功)[!！.。]*\s*$/i,
      /^已(创建|生成|写入|保存|修改|更新)/,
      /^(File|文件)\s+(created|saved|written)/i,
      /^\s*$/,
      /^```/,  // code fences
      /^---+$/,  // horizontal rules
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
    if (!memory || memory.trim().length === 0) return '';
    return `\n\n[Workflow Memory - Previous Sessions]\n${memory.substring(0, 10000)}\n`;
  }

  static listMemories() {
    try {
      const result = [];
      if (!MemoryService._baseDir) return [];
      if (!fs.existsSync(MemoryService._baseDir)) return [];
      for (const f of fs.readdirSync(MemoryService._baseDir)) {
        if (f.endsWith('.md')) {
          const workflowId = f.replace('.md', '');
          result.push({ workflowId, path: path.join(MemoryService._baseDir, f) });
        }
      }
      return result;
    } catch (e) { return []; }
  }

  static deleteMemory(workflowId) {
    try {
      const filePath = MemoryService._getMemoryPath(workflowId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      MemoryService._cache.delete(workflowId);
      return true;
    } catch (e) { return false; }
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
        if (pool.notes.length !== before) changed = true;
      }

      if (changed) {
        pool.lastUpdated = new Date().toISOString();
        MemoryService.updateSharedPool(pool);
      }
      return true;
    } catch (e) { return false; }
  }

  /**
   * Archive current memory before a new execution (rename to .bak)
   */
  static archiveMemory(workflowId) {
    try {
      const filePath = MemoryService._getMemoryPath(workflowId);
      if (!fs.existsSync(filePath)) return false;
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.trim()) return false;
      const bakPath = filePath + '.bak';
      fs.writeFileSync(bakPath, content, 'utf-8');
      // Clear current memory (new execution starts fresh, but archive is preserved)
      fs.writeFileSync(filePath, '', 'utf-8');
      return true;
    } catch (e) { return false; }
  }

  // Backward compatibility: old agent+workflow scoped methods redirect to workflow-only
  static getMemoryLegacy(agentId, workflowId) {
    return MemoryService.getMemory(workflowId);
  }
  static appendMemoryLegacy(agentId, workflowId, entry) {
    return MemoryService.appendMemory(workflowId, entry);
  }
  static injectMemoryLegacy(agentId, workflowId) {
    return MemoryService.injectMemory(workflowId);
  }
}

module.exports = MemoryService;
