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
  createdAt: Date;
  updatedAt: Date;
}

export class KnowledgeService {
  private static entries: Map<string, KnowledgeEntry> = new Map();
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
        this.entries.clear();
        for (const entry of data) {
          if (entry && entry.id) {
            // 恢复 Date 对象
            entry.createdAt = new Date(entry.createdAt);
            entry.updatedAt = new Date(entry.updatedAt);
            this.entries.set(entry.id, entry);
          }
        }
        logger.info(`Loaded ${this.entries.size} knowledge entries from disk`);
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
      const data = Array.from(this.entries.values());
      atomicWriteSync(this._persistPath, JSON.stringify(data, null, 2));
    } catch (e: any) {
      logger.error(`Failed to persist knowledge data: ${e.message}`);
    }
  }

  /**
   * 添加知识条目
   */
  static addEntry(title: string, content: string, category: string, tags: string[] = []): KnowledgeEntry {
    const entry: KnowledgeEntry = {
      id: Math.random().toString(36).substring(7),
      title,
      content,
      category,
      tags,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.entries.set(entry.id, entry);
    this._persist();
    return entry;
  }

  /**
   * 更新知识条目
   */
  static updateEntry(entryId: string, updates: Partial<KnowledgeEntry>): KnowledgeEntry | null {
    const entry = this.entries.get(entryId);
    if (!entry) return null;

    if (updates.title !== undefined) entry.title = updates.title;
    if (updates.content !== undefined) entry.content = updates.content;
    if (updates.category !== undefined) entry.category = updates.category;
    if (updates.tags !== undefined) entry.tags = updates.tags;
    entry.updatedAt = new Date();

    this.entries.set(entryId, entry);
    this._persist();
    return entry;
  }

  /**
   * 删除知识条目
   */
  static deleteEntry(entryId: string): boolean {
    const result = this.entries.delete(entryId);
    if (result) this._persist();
    return result;
  }

  /**
   * 获取知识条目
   */
  static getEntry(entryId: string): KnowledgeEntry | undefined {
    return this.entries.get(entryId);
  }

  /**
   * 搜索知识条目
   */
  static search(query: string, options?: { category?: string; limit?: number }): { items: KnowledgeEntry[] } {
    let results = Array.from(this.entries.values());

    if (options?.category) {
      results = results.filter(entry => entry.category === options.category);
    }

    if (query) {
      const q = query.toLowerCase();
      results = results.filter(entry =>
        entry.title.toLowerCase().includes(q) || entry.content.toLowerCase().includes(q)
      );
    }

    // 按更新时间倒序
    results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return { items: results };
  }

  /**
   * 获取所有知识条目
   */
  static getAll(): KnowledgeEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * 清空（用于工作区切换）
   */
  static clear(): void {
    this.entries.clear();
  }

  /**
   * 重新加载数据
   */
  static reload(entries: KnowledgeEntry[]): void {
    if (!Array.isArray(entries)) return;
    this.entries.clear();
    for (const entry of entries) {
      if (entry && entry.id) {
        this.entries.set(entry.id, entry);
      }
    }
  }

  // ── 兼容路由调用的别名方法 ──

  /**
   * 添加条目（兼容路由调用）
   */
  static add(data: any): KnowledgeEntry {
    return this.addEntry(
      data.title || '',
      data.content || '',
      data.category || 'default',
      Array.isArray(data.tags) ? data.tags : []
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
