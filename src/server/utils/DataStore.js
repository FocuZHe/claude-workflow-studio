const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// sql.js 引擎（延迟初始化）
let SQL = null;

class DataStore {
  /**
   * 启动时调用一次，初始化 sql.js 引擎。
   * 在此之前 DataStore 自动回退到 JSON 存储。
   * @returns {Promise<void>}
   */
  static async init() {
    if (SQL) return;
    const initSqlJs = require('sql.js');
    SQL = await initSqlJs();
    logger.info('sql.js engine initialized');
  }

  /**
   * @param {string} filePath - JSON 文件路径（如 data/workflows.json）
   *                           SQLite 存储为同目录同名 .sqlite 文件
   */
  constructor(filePath) {
    this.filePath = filePath;
    this.dir = path.dirname(filePath);
    this.sqlitePath = filePath.replace(/\.json$/i, '.sqlite');
    this.bakPath = this.sqlitePath + '.bak';
    this._data = null; // null = 未加载
    this._useSqlite = false;
  }

  ensureDir() {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  /**
   * 加载数据（返回内存数组）。
   * sql.js 已初始化 → SQLite；未初始化 → JSON 回退。
   * @returns {Array}
   */
  load() {
    // 首次加载
    if (this._data === null) {
      this._loadSync();
      return this._data;
    }
    // 已加载但仍在用 JSON，而 sql.js 已就绪 → 触发迁移
    if (!this._useSqlite && SQL) {
      try {
        if (!fs.existsSync(this.sqlitePath)) {
          this._saveSqlite(this._data);
          try { fs.renameSync(this.filePath, this.filePath + '.migrated'); } catch (_) {}
          logger.info(`Migrated ${path.basename(this.filePath)} → SQLite (lazy)`);
        }
        this._useSqlite = true;
      } catch (e) {
        logger.warn(`Lazy migration failed for ${this.filePath}: ${e.message}`);
      }
    }
    return this._data;
  }

  /**
   * 保存数据 — SQLite 或 JSON 回退。
   * @param {Array} data
   */
  save(data) {
    this._data = data;
    if (SQL && this._useSqlite) {
      this._saveSqlite(data);
    } else {
      this._saveJson(data);
    }
  }

  /**
   * 异步保存 — 保留以兼容旧调用方。
   * @param {Array} data
   */
  async saveAsync(data) {
    this.save(data);
  }

  // ─── 内部方法 ─────────────────────────────────────────

  _loadSync() {
    this.ensureDir();

    // sql.js 已初始化 → 尝试 SQLite
    if (SQL) {
      try {
        if (fs.existsSync(this.sqlitePath)) {
          const buf = fs.readFileSync(this.sqlitePath);
          const db = new SQL.Database(buf);
          const res = db.exec('SELECT value FROM kv ORDER BY rowid');
          db.close();
          this._data = res.length > 0
            ? res[0].values.map(row => JSON.parse(row[0]))
            : [];
          this._useSqlite = true;
          return;
        }

        // 无 SQLite 文件 — 从 JSON 迁移
        if (fs.existsSync(this.filePath)) {
          logger.info(`Migrating ${path.basename(this.filePath)} → SQLite...`);
          const raw = fs.readFileSync(this.filePath, 'utf-8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            this._data = parsed;
            this._useSqlite = true;
            this._saveSqlite(parsed);
            try {
              fs.renameSync(this.filePath, this.filePath + '.migrated');
              logger.info(`Migration done: ${path.basename(this.sqlitePath)}`);
            } catch (_) {}
            return;
          }
        }

        // 都不存在 — 空数据
        this._data = [];
        this._useSqlite = true;
        return;
      } catch (e) {
        logger.error(`SQLite load failed ${this.sqlitePath}: ${e.message}, falling back to JSON`);
        // 尝试备份恢复
        if (this._tryRecoverFromBackup()) return;
      }
    }

    // sql.js 未初始化或 SQLite 失败 — JSON 回退
    this._loadJson();
  }

  _loadJson() {
    this._useSqlite = false;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this._data = JSON.parse(raw);
        if (!Array.isArray(this._data)) this._data = [];
        return;
      }

      // .json not found — may have been renamed to .migrated after previous migration
      const migratedPath = this.filePath + '.migrated';
      if (fs.existsSync(migratedPath)) {
        try {
          logger.warn(`Recovering from ${path.basename(migratedPath)}`);
          const raw = fs.readFileSync(migratedPath, 'utf-8');
          this._data = JSON.parse(raw);
          if (!Array.isArray(this._data)) this._data = [];
          // Write recovered data to SQLite so subsequent loads don't need .migrated again
          if (SQL) {
            try {
              this._useSqlite = true;
              this._saveSqlite(this._data);
              logger.info(`Recovered from .migrated and saved to SQLite: ${path.basename(this.sqlitePath)}`);
            } catch (e) {
              logger.warn(`Failed to save recovered data to SQLite: ${e.message}`);
              this._useSqlite = false;
            }
          }
          return;
        } catch (e) {
          logger.error(`Migrated file load failed ${migratedPath}: ${e.message}`);
        }
      }

      this._data = [];
    } catch (e) {
      logger.error(`JSON load failed ${this.filePath}: ${e.message}`);
      // 尝试 .bak
      const bakPath = this.filePath + '.bak';
      if (fs.existsSync(bakPath)) {
        try {
          const raw = fs.readFileSync(bakPath, 'utf-8');
          this._data = JSON.parse(raw);
          fs.copyFileSync(bakPath, this.filePath);
          return;
        } catch (_) {}
      }
      this._data = [];
    }
  }

  _tryRecoverFromBackup() {
    if (!fs.existsSync(this.bakPath)) return false;
    try {
      logger.warn(`Recovering from ${path.basename(this.bakPath)}`);
      const buf = fs.readFileSync(this.bakPath);
      const db = new SQL.Database(buf);
      const res = db.exec('SELECT value FROM kv ORDER BY rowid');
      db.close();
      this._data = res.length > 0
        ? res[0].values.map(row => JSON.parse(row[0]))
        : [];
      this._useSqlite = true;
      fs.copyFileSync(this.bakPath, this.sqlitePath);
      logger.info('Recovery successful');
      return true;
    } catch (e) {
      logger.error(`Recovery failed: ${e.message}`);
      return false;
    }
  }

  _saveSqlite(data) {
    try {
      // 备份
      if (fs.existsSync(this.sqlitePath)) {
        try { fs.copyFileSync(this.sqlitePath, this.bakPath); } catch (_) {}
      }

      const db = new SQL.Database();
      db.run('CREATE TABLE IF NOT EXISTS kv (value TEXT)');
      const stmt = db.prepare('INSERT INTO kv (value) VALUES (?)');
      for (const item of data) {
        stmt.run([JSON.stringify(item)]);
      }
      stmt.free();
      const bytes = db.export();
      db.close();

      const tmpPath = this.sqlitePath + '.tmp';
      fs.writeFileSync(tmpPath, Buffer.from(bytes));
      fs.renameSync(tmpPath, this.sqlitePath);
    } catch (e) {
      logger.error(`SQLite save failed: ${e.message}`);
      try { fs.unlinkSync(this.sqlitePath + '.tmp'); } catch (_) {}
      throw e;
    }
  }

  _saveJson(data) {
    try {
      const json = JSON.stringify(data, null, 2);
      if (fs.existsSync(this.filePath)) {
        try { fs.copyFileSync(this.filePath, this.filePath + '.bak'); } catch (_) {}
      }
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, json, 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (e) {
      logger.error(`JSON save failed: ${e.message}`);
      try { fs.unlinkSync(this.filePath + '.tmp'); } catch (_) {}
      throw e;
    }
  }
}

module.exports = DataStore;
