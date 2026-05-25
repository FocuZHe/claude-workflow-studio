const fs = require('fs');
const path = require('path');
const { generateId } = require('../utils/id');
const logger = require('../utils/logger');

class ArtifactIndexService {
  static _indexPath = null;
  static _index = [];
  static _watcher = null;
  static _watchTimer = null;

  static init(workspaceRoot) {
    ArtifactIndexService._indexPath = path.join(workspaceRoot, 'WORKFLOWS', 'artifact-index.json');
    ArtifactIndexService._load();
    ArtifactIndexService.startWatching(workspaceRoot);
  }

  static _load() {
    try {
      if (fs.existsSync(ArtifactIndexService._indexPath)) {
        ArtifactIndexService._index = JSON.parse(fs.readFileSync(ArtifactIndexService._indexPath, 'utf-8'));
      }
    } catch (e) {
      ArtifactIndexService._index = [];
    }
  }

  static _save() {
    try {
      if (ArtifactIndexService._indexPath) {
        const dir = path.dirname(ArtifactIndexService._indexPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(ArtifactIndexService._indexPath, JSON.stringify(ArtifactIndexService._index, null, 2), 'utf-8');
      }
    } catch (e) {
      logger.error('Failed to save artifact index: ' + e.message);
    }
  }

  static indexFile(filePath, metadata = {}) {
    const FileService = require('./FileService');
    const workspaceRoot = FileService.getWorkspaceRoot();
    if (!workspaceRoot) return null;

    const resolved = path.resolve(filePath);
    const normalizedRoot = path.resolve(workspaceRoot).replace(/\\/g, '/');
    const normalizedResolved = resolved.replace(/\\/g, '/');
    if (!normalizedResolved.startsWith(normalizedRoot + '/') && normalizedResolved !== normalizedRoot) {
      return null;
    }

    const relativePath = path.relative(workspaceRoot, resolved).replace(/\\/g, '/');

    const existing = ArtifactIndexService._index.find(a => a.filePath === relativePath);
    if (existing) {
      Object.assign(existing, {
        modifiedAt: new Date().toISOString(),
        size: ArtifactIndexService._getFileSize(resolved),
        ...metadata
      });
      ArtifactIndexService._save();
      return existing;
    }

    const size = ArtifactIndexService._getFileSize(resolved);
    const artifact = {
      id: generateId(),
      fileName: path.basename(filePath),
      filePath: relativePath,
      absolutePath: resolved,
      mimeType: ArtifactIndexService._getMimeType(filePath),
      size,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      workflowId: metadata.workflowId || null,
      workflowName: metadata.workflowName || null,
      runId: metadata.runId || null,
      nodeId: metadata.nodeId || null,
      tags: metadata.tags || [],
      contentPreview: ArtifactIndexService._getContentPreview(resolved)
    };

    ArtifactIndexService._index.push(artifact);
    ArtifactIndexService._save();
    return artifact;
  }

  static search(query = '', filters = {}) {
    let results = [...ArtifactIndexService._index];

    if (query) {
      const q = query.toLowerCase();
      results = results.filter(a =>
        a.fileName.toLowerCase().includes(q) ||
        (a.contentPreview || '').toLowerCase().includes(q) ||
        (a.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }

    if (filters.workflowId) {
      results = results.filter(a => a.workflowId === filters.workflowId);
    }

    if (filters.type) {
      results = results.filter(a => a.mimeType && a.mimeType.startsWith(filters.type));
    }

    results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 100);
    const start = (page - 1) * limit;

    return {
      items: results.slice(start, start + limit),
      total: results.length,
      page,
      limit
    };
  }

  static remove(id) {
    const idx = ArtifactIndexService._index.findIndex(a => a.id === id);
    if (idx === -1) return false;
    ArtifactIndexService._index.splice(idx, 1);
    ArtifactIndexService._save();
    return true;
  }

  static reindex(workspaceRoot) {
    ArtifactIndexService._index = [];
    const scanDir = (dir, depth = 0) => {
      if (depth > 3) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'WORKFLOWS' || entry.name === 'node_modules') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isFile()) {
            ArtifactIndexService.indexFile(fullPath);
          } else if (entry.isDirectory()) {
            scanDir(fullPath, depth + 1);
          }
        }
      } catch (e) { /* ignore */ }
    };
    scanDir(workspaceRoot);
    ArtifactIndexService._save();
    return ArtifactIndexService._index.length;
  }

  static _getFileSize(filePath) {
    try { return fs.statSync(filePath).size; } catch (e) { return 0; }
  }

  static _getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = { '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.js': 'text/javascript', '.py': 'text/x-python', '.html': 'text/html', '.css': 'text/css' };
    return map[ext] || 'application/octet-stream';
  }

  static _getContentPreview(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return content.substring(0, 500);
    } catch (e) { return ''; }
  }

  static startWatching(workspaceRoot) {
    if (ArtifactIndexService._watcher) {
      ArtifactIndexService._watcher.close();
    }

    try {
      ArtifactIndexService._watcher = fs.watch(workspaceRoot, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        // 跳过排除的目录
        if (filename.startsWith('WORKFLOWS') || filename.startsWith('.') || filename.startsWith('node_modules')) return;

        const fullPath = path.join(workspaceRoot, filename);

        // 延迟处理，避免频繁触发
        if (ArtifactIndexService._watchTimer) clearTimeout(ArtifactIndexService._watchTimer);
        ArtifactIndexService._watchTimer = setTimeout(() => {
          try {
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
              ArtifactIndexService.indexFile(fullPath);
              logger.info(`Auto-indexed: ${filename}`);
            }
          } catch (e) { /* ignore */ }
        }, 1000);
      });

      // unref() prevents the watcher from keeping the Node.js process alive
      if (ArtifactIndexService._watcher && typeof ArtifactIndexService._watcher.unref === 'function') {
        ArtifactIndexService._watcher.unref();
      }

      logger.info(`Started watching workspace: ${workspaceRoot}`);
    } catch (e) {
      logger.warn(`Failed to watch workspace: ${e.message}`);
    }
  }

  static stopWatching() {
    if (ArtifactIndexService._watcher) {
      ArtifactIndexService._watcher.close();
      ArtifactIndexService._watcher = null;
    }
    if (ArtifactIndexService._watchTimer) {
      clearTimeout(ArtifactIndexService._watchTimer);
      ArtifactIndexService._watchTimer = null;
    }
  }
}

module.exports = ArtifactIndexService;
