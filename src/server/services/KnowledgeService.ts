/**
 * KnowledgeService - 知识库服务
 * 管理知识库条目，支持本地持久化
 */

const fs = require('fs');
const path = require('path');
const { atomicWriteSync } = require('../utils/atomicWrite');
const logger = require('../utils/logger');

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

export class KnowledgeService {
  // _index 为数组（测试直接赋值清空）
  static _index: KnowledgeEntry[] = [];
  private static _initialized: boolean = false;
  private static _persistPath: string = '';

  /**
   * 初始化服务，加载持久化数据
   */
  static init(workspacePath: string): void {
    this._persistPath = path.join(workspacePath, 'WORKFLOWS', 'knowledge.json');
    this._load();
    this._initialized = true;
  }

  /**
   * 从磁盘加载数据
   */
  private static _load(): void {
    try {
      if (!this._persistPath || !fs.existsSync(this._persistPath)) return;
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
    } catch (e: any) {
      logger.warn(`Failed to load knowledge data: ${e.message}`);
    }
  }

  /**
   * 持久化到磁盘
   */
  private static _persist(): void {
    try {
      if (!this._persistPath) return;
      const dir = path.dirname(this._persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      atomicWriteSync(this._persistPath, JSON.stringify(this._index, null, 2));
    } catch (e: any) {
      logger.error(`Failed to persist knowledge data: ${e.message}`);
    }
  }

  /**
   * 添加知识条目
   */
  static addEntry(title: string, content: string, category: string, tags: string[] = [], source: string = 'manual'): KnowledgeEntry {
    const entry: KnowledgeEntry = {
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
  static updateEntry(entryId: string, updates: Partial<KnowledgeEntry>): KnowledgeEntry | null {
    const entry = this._index.find(e => e.id === entryId);
    if (!entry) return null;

    if (updates.title !== undefined) entry.title = updates.title;
    if (updates.content !== undefined) entry.content = updates.content;
    if (updates.category !== undefined) entry.category = updates.category;
    if (updates.tags !== undefined) entry.tags = updates.tags;
    if (updates.source !== undefined) entry.source = updates.source;
    entry.updatedAt = new Date();

    this._persist();
    return entry;
  }

  /**
   * 删除知识条目
   */
  static deleteEntry(entryId: string): boolean {
    const idx = this._index.findIndex(e => e.id === entryId);
    if (idx === -1) return false;
    this._index.splice(idx, 1);
    this._persist();
    return true;
  }

  /**
   * 获取知识条目
   */
  static getEntry(entryId: string): KnowledgeEntry | undefined {
    return this._index.find(e => e.id === entryId);
  }

  /**
   * 搜索知识条目（支持 query/category/tag/page/limit，返回 { items, total }）
   */
  static search(query: string, options?: { category?: string; tag?: string; page?: number; limit?: number }): { items: KnowledgeEntry[]; total: number } {
    let results = this._index.slice();

    if (options?.category) {
      results = results.filter(entry => entry.category === options.category);
    }

    if (options?.tag) {
      results = results.filter(entry => Array.isArray(entry.tags) && entry.tags.includes(options.tag!));
    }

    if (query) {
      const q = query.toLowerCase();
      results = results.filter(entry =>
        (entry.title || '').toLowerCase().includes(q) || (entry.content || '').toLowerCase().includes(q)
      );
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
  static getAll(): KnowledgeEntry[] {
    return this._index.slice();
  }

  /**
   * 清空（用于工作区切换）
   */
  static clear(): void {
    this._index = [];
  }

  /**
   * 重新加载数据
   */
  static reload(entries: KnowledgeEntry[]): void {
    if (!Array.isArray(entries)) return;
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
  static add(data: any): KnowledgeEntry {
    return this.addEntry(
      data.title || '',
      data.content || '',
      data.category || 'general',
      Array.isArray(data.tags) ? data.tags : [],
      data.source || 'manual'
    );
  }

  /**
   * 更新条目（兼容路由调用）
   */
  static update(entryId: string, data: any): KnowledgeEntry | null {
    return this.updateEntry(entryId, data);
  }

  /**
   * 删除条目（兼容路由调用）
   */
  static delete(entryId: string): boolean {
    return this.deleteEntry(entryId);
  }
}

module.exports = KnowledgeService;
