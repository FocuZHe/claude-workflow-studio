"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const FileService = require('../services/FileService');
const WorkspaceStateService = require('../services/WorkspaceStateService');
const { AppError } = require('../middleware/errorHandler');
// In-memory undo cache store (keyed by file path)
const undoCacheStore = new Map();
// Exposed for workspace deactivation cleanup
// When workspacePath is provided, only clears entries under that path
router.clearUndoCache = (workspacePath) => {
    if (workspacePath) {
        const normalized = path.resolve(workspacePath).replace(/\\/g, '/');
        for (const [key] of undoCacheStore) {
            if (key.replace(/\\/g, '/').startsWith(normalized)) {
                undoCacheStore.delete(key);
            }
        }
    }
    else {
        undoCacheStore.clear();
    }
};
/**
 * GET /api/files/undo-cache - Get undo cache for a file
 */
router.get('/undo-cache', (req, res, next) => {
    try {
        const filePath = req.query.path;
        if (!filePath) {
            return res.json({ success: true, data: null });
        }
        const cached = undoCacheStore.get(filePath) || null;
        res.json({ success: true, data: cached });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/files/undo-cache - Save undo cache for a file
 */
router.post('/undo-cache', (req, res) => {
    const { path: filePath, history, currentIndex } = req.body;
    if (!filePath || !Array.isArray(history)) {
        throw new AppError('VALIDATION_ERROR', 'path and history array are required', 400);
    }
    undoCacheStore.set(filePath, { history, currentIndex });
    res.json({ success: true, data: null });
});
/**
 * DELETE /api/files/undo-cache - Clear undo cache for a file (or all)
 */
router.delete('/undo-cache', (req, res) => {
    const filePath = req.query.path;
    if (filePath) {
        undoCacheStore.delete(filePath);
    }
    else {
        undoCacheStore.clear();
    }
    res.json({ success: true, data: null });
});
/**
 * GET /api/files/parent - Get parent directory path
 */
router.get('/parent', (req, res) => {
    const filePath = req.query.path;
    if (!filePath) {
        return res.json({ success: true, data: { parentPath: null } });
    }
    const normalized = filePath.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash <= 0) {
        return res.json({ success: true, data: { parentPath: '' } });
    }
    const parentPath = normalized.substring(0, lastSlash);
    res.json({ success: true, data: { parentPath } });
});
/**
 * POST /api/files/import - Import a file from an absolute path into the workspace
 */
router.post('/import', (req, res, next) => {
    try {
        const { sourcePath, targetPath } = req.body;
        if (!sourcePath || !targetPath) {
            throw new AppError('VALIDATION_ERROR', 'sourcePath and targetPath are required', 400);
        }
        // Validate source path is within workspace boundary (prevents path traversal)
        const resolvedSource = FileService.resolvePath(sourcePath);
        if (!fs.existsSync(resolvedSource)) {
            throw new AppError('NOT_FOUND', `Source file '${sourcePath}' not found`, 404);
        }
        if (!fs.statSync(resolvedSource).isFile()) {
            throw new AppError('VALIDATION_ERROR', '源路径不是文件', 400);
        }
        // Read source and write to target
        const content = fs.readFileSync(resolvedSource, 'utf-8');
        const data = FileService.writeFile(targetPath, content);
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/files/browse - Browse directories only
 * NOTE: This route MUST be registered before GET / to avoid Express
 * matching /browse as a path parameter for the / route.
 */
router.get('/browse', (req, res, next) => {
    try {
        const filePath = req.query.path || '';
        const data = FileService.browseDirectories(filePath);
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
});
const MIME_TYPES = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
    pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav',
    mp4: 'video/mp4', avi: 'video/x-msvideo',
    ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};
/**
 * GET /api/files/raw - Serve a file as raw binary with proper Content-Type
 */
router.get('/raw', (req, res, next) => {
    try {
        const filePath = req.query.path;
        if (!filePath) {
            throw new AppError('VALIDATION_ERROR', 'path is required', 400);
        }
        const resolved = FileService.resolvePath(filePath);
        if (!fs.existsSync(resolved)) {
            throw new AppError('NOT_FOUND', '文件未找到', 404);
        }
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) {
            throw new AppError('VALIDATION_ERROR', '不是文件', 400);
        }
        const ext = path.extname(resolved).slice(1).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        fs.createReadStream(resolved).pipe(res);
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/files - List directory contents
 */
router.get('/', (req, res, next) => {
    try {
        const filePath = req.query.path || '';
        const entries = FileService.listDirectory(filePath);
        res.json({ success: true, data: entries });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/files/read - Read file content
 */
router.get('/read', (req, res, next) => {
    try {
        const filePath = req.query.path;
        if (!filePath) {
            throw new AppError('VALIDATION_ERROR', 'path query parameter is required', 400);
        }
        const data = FileService.readFile(filePath);
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/files/write - Write/create file
 */
router.post('/write', (req, res, next) => {
    try {
        const { path: filePath, content } = req.body;
        if (!filePath) {
            throw new AppError('VALIDATION_ERROR', 'path is required', 400);
        }
        if (content === undefined || content === null) {
            throw new AppError('VALIDATION_ERROR', 'content is required', 400);
        }
        // Limit file write size to 10MB
        const MAX_WRITE_SIZE = 10 * 1024 * 1024;
        if (typeof content === 'string' && content.length > MAX_WRITE_SIZE) {
            throw new AppError('VALIDATION_ERROR', `Content too large (${Math.round(content.length / 1024 / 1024)}MB). Max 10MB.`, 400);
        }
        const data = FileService.writeFile(filePath, content);
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/files/mkdir - Create directory
 */
router.post('/mkdir', (req, res, next) => {
    try {
        const { path: dirPath } = req.body;
        if (!dirPath) {
            throw new AppError('VALIDATION_ERROR', 'path is required', 400);
        }
        const data = FileService.createDirectory(dirPath);
        res.status(201).json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
});
/**
 * DELETE /api/files - Delete file or directory
 */
router.delete('/', (req, res, next) => {
    try {
        const { path: filePath } = req.body;
        if (!filePath) {
            throw new AppError('VALIDATION_ERROR', 'path is required', 400);
        }
        const data = FileService.deletePath(filePath);
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/files/rename - Rename/move file
 */
router.post('/rename', (req, res, next) => {
    try {
        const { oldPath, newPath } = req.body;
        if (!oldPath || !newPath) {
            throw new AppError('VALIDATION_ERROR', 'oldPath and newPath are required', 400);
        }
        const data = FileService.renamePath(oldPath, newPath);
        res.json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
});
/**
 * POST /api/files/set-workspace - Set active workspace root at runtime
 * Response includes loaded state from WORKFLOWS folder
 */
router.post('/set-workspace', (req, res, next) => {
    try {
        const { path: newPath } = req.body;
        if (!newPath) {
            throw new AppError('VALIDATION_ERROR', 'path is required', 400);
        }
        const result = FileService.setWorkspaceRoot(newPath);
        // Persist current workspace path for restart recovery
        try {
            const config = require('../config');
            const currentFile = require('path').join(config.data.dir, 'current-workspace.json');
            require('fs').writeFileSync(currentFile, JSON.stringify({ path: newPath }, null, 2), 'utf-8');
        }
        catch (e) { /* ignore */ }
        // 广播工作区变更事件
        const bs = global.__broadcastService;
        if (bs) {
            bs.broadcast('workspace.changed', { path: newPath, workspaceId: result?.id });
        }
        res.json({ success: true, data: result });
    }
    catch (err) {
        next(err);
    }
});
/**
 * GET /api/files/workspace-info - Get current workspace root info
 * Includes recent workspace history
 */
router.get('/workspace-info', (req, res) => {
    const history = WorkspaceStateService.getHistory();
    res.json({
        success: true,
        data: {
            path: FileService.getWorkspaceRoot(),
            isDefault: !FileService.runtimeWorkspaceRoot,
            recentWorkspaces: history
        }
    });
});
/**
 * POST /api/files/workspace - Create workspace
 */
router.post('/workspace', (req, res, next) => {
    try {
        const { name, template, parentPath } = req.body;
        if (!name) {
            throw new AppError('VALIDATION_ERROR', 'name is required', 400);
        }
        const data = FileService.createWorkspace(name, template, parentPath);
        res.status(201).json({ success: true, data });
    }
    catch (err) {
        next(err);
    }
});
module.exports = router;
//# sourceMappingURL=files.js.map