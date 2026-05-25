const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const ArtifactIndexService = require('../services/ArtifactIndexService');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

router.get('/', (req, res, next) => {
  try {
    const { q, workflowId, type, page, limit } = req.query;
    const result = ArtifactIndexService.search(q, {
      workflowId, type,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/reindex', (req, res, next) => {
  try {
    const FileService = require('../services/FileService');
    const workspaceRoot = FileService.getWorkspaceRoot();
    if (!workspaceRoot) throw new AppError('VALIDATION_ERROR', '没有活跃的工作区', 400);
    const count = ArtifactIndexService.reindex(workspaceRoot);
    res.json({ success: true, data: { indexed: count } });
  } catch (err) { next(err); }
});

// 获取文件内容
router.get('/:id/content', (req, res, next) => {
  try {
    const { id } = req.params;
    const FileService = require('../services/FileService');
    const workspaceRoot = FileService.getWorkspaceRoot();
    if (!workspaceRoot) throw new AppError('VALIDATION_ERROR', '没有活跃的工作区', 400);

    // 在索引中查找文件
    const artifact = ArtifactIndexService._index.find(a => a.id === id);
    if (!artifact) {
      throw new AppError('NOT_FOUND', '工件未找到', 404);
    }

    const fullPath = path.join(workspaceRoot, artifact.filePath);

    // 验证路径在工作区内
    const normalizedRoot = path.resolve(workspaceRoot).replace(/\\/g, '/');
    const normalizedPath = path.resolve(fullPath).replace(/\\/g, '/');
    if (!normalizedPath.startsWith(normalizedRoot)) {
      throw new AppError('FORBIDDEN', '路径在工作区之外', 403);
    }

    if (!fs.existsSync(fullPath)) {
      throw new AppError('NOT_FOUND', '磁盘上未找到文件', 404);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    res.json({
      success: true,
      data: {
        content,
        fileName: artifact.fileName,
        filePath: artifact.filePath,
        mimeType: artifact.mimeType
      }
    });
  } catch (err) { next(err); }
});

// 删除文件（同时删除索引和实际文件）
router.delete('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const FileService = require('../services/FileService');
    const workspaceRoot = FileService.getWorkspaceRoot();
    if (!workspaceRoot) throw new AppError('VALIDATION_ERROR', '没有活跃的工作区', 400);

    // 在索引中查找文件
    const artifact = ArtifactIndexService._index.find(a => a.id === id);
    if (!artifact) {
      throw new AppError('NOT_FOUND', '工件未找到', 404);
    }

    // 删除实际文件
    const fullPath = path.join(workspaceRoot, artifact.filePath);
    const normalizedRoot = path.resolve(workspaceRoot).replace(/\\/g, '/');
    const normalizedPath = path.resolve(fullPath).replace(/\\/g, '/');

    if (normalizedPath.startsWith(normalizedRoot) && fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      logger.info(`Deleted file: ${fullPath}`);
    }

    // 从索引删除
    ArtifactIndexService.remove(id);

    res.json({ success: true, data: { removed: true, fileName: artifact.fileName } });
  } catch (err) { next(err); }
});

module.exports = router;
