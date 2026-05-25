const fs = require('fs');
const path = require('path');
const { generateId } = require('../utils/id');
const logger = require('../utils/logger');

class KnowledgeService {
  static _indexPath = null;
  static _index = [];

  static init(workspaceRoot) {
    KnowledgeService._indexPath = path.join(workspaceRoot, 'WORKFLOWS', 'knowledge.json');
    KnowledgeService._load();
  }

  static _load() {
    try {
      if (fs.existsSync(KnowledgeService._indexPath)) {
        KnowledgeService._index = JSON.parse(fs.readFileSync(KnowledgeService._indexPath, 'utf-8'));
      } else {
        // 创建空文件
        KnowledgeService._index = [];
        KnowledgeService._save();
      }
    } catch (e) { KnowledgeService._index = []; }
  }

  static _save() {
    try {
      fs.writeFileSync(KnowledgeService._indexPath, JSON.stringify(KnowledgeService._index, null, 2));
    } catch (e) { logger.error('Failed to save knowledge: ' + e.message); }
  }

  static add(data) {
    const entry = {
      id: generateId(),
      title: data.title,
      content: data.content,
      category: data.category || 'general',
      tags: data.tags || [],
      source: data.source || 'manual',
      sourceId: data.sourceId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    KnowledgeService._index.push(entry);
    KnowledgeService._save();
    return entry;
  }

  static update(id, data) {
    const idx = KnowledgeService._index.findIndex(k => k.id === id);
    if (idx === -1) return null;
    Object.assign(KnowledgeService._index[idx], data, { updatedAt: new Date().toISOString() });
    KnowledgeService._save();
    return KnowledgeService._index[idx];
  }

  static delete(id) {
    const idx = KnowledgeService._index.findIndex(k => k.id === id);
    if (idx === -1) return false;
    KnowledgeService._index.splice(idx, 1);
    KnowledgeService._save();
    return true;
  }

  static search(query, filters = {}) {
    let results = [...KnowledgeService._index];
    if (query) {
      const q = query.toLowerCase();
      results = results.filter(k =>
        k.title.toLowerCase().includes(q) ||
        k.content.toLowerCase().includes(q) ||
        k.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    if (filters.category) results = results.filter(k => k.category === filters.category);
    if (filters.tag) results = results.filter(k => k.tags.includes(filters.tag));
    results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 100);
    return { items: results.slice((page - 1) * limit, page * limit), total: results.length, page, limit };
  }

  static getAll() { return KnowledgeService._index; }
}
module.exports = KnowledgeService;
