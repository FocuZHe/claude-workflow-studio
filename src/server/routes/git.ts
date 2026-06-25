const express = require('express');
const router = express.Router();
const GitService = require('../services/GitService');
const FileService = require('../services/FileService');
const { AppError } = require('../middleware/errorHandler');
const { requireFields, validatePagination } = require('../middleware/validation');

/**
 * Helper to get the current workspace directory
 * 校验 cwd 必须在活跃工作区内，防止在任意目录执行 git 命令
 */
function getCwd(req: any) {
  const cwd = req.query.cwd || req.body.cwd || FileService.getWorkspaceRoot();
  if (!cwd) {
    throw new AppError('VALIDATION_ERROR', '没有可用的工作区目录', 400);
  }
  // 校验 cwd 是否在活跃工作区内
  const workspaceRoot = FileService.getWorkspaceRoot();
  if (workspaceRoot) {
    const path = require('path');
    const normalizedRoot = path.resolve(workspaceRoot).replace(/\\/g, '/');
    const normalizedCwd = path.resolve(cwd).replace(/\\/g, '/');
    if (normalizedCwd !== normalizedRoot && !normalizedCwd.startsWith(normalizedRoot + '/')) {
      throw new AppError('FORBIDDEN', 'Git 操作仅限当前工作区目录', 403);
    }
  }
  return cwd;
}

/**
 * GET /api/git/check - Check if current workspace is a git repo
 */
router.get('/check', async (req: any, res: any, next: any) => {
  try {
    const cwd = getCwd(req);
    const isRepo = await GitService.isGitRepo(cwd);
    res.json({ success: true, data: { isRepo, path: cwd } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/git/status - Git status
 */
router.get('/status', async (req: any, res: any, next: any) => {
  try {
    const cwd = getCwd(req);
    const isRepo = await GitService.isGitRepo(cwd);
    if (!isRepo) {
      throw new AppError('NOT_GIT_REPO', '目录不是 Git 仓库', 400);
    }
    const status = await GitService.getStatus(cwd);
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/git/diff - Git diff
 */
router.get('/diff', async (req: any, res: any, next: any) => {
  try {
    const cwd = getCwd(req);
    const isRepo = await GitService.isGitRepo(cwd);
    if (!isRepo) {
      throw new AppError('NOT_GIT_REPO', '目录不是 Git 仓库', 400);
    }
    const diff = await GitService.getDiff(cwd, req.query.file);
    res.json({ success: true, data: { diff, file: req.query.file || null } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/git/log - Git log
 */
router.get('/log', async (req: any, res: any, next: any) => {
  try {
    const cwd = getCwd(req);
    const isRepo = await GitService.isGitRepo(cwd);
    if (!isRepo) {
      throw new AppError('NOT_GIT_REPO', '目录不是 Git 仓库', 400);
    }
    const limit = parseInt(req.query.limit, 10) || 20;
    const log = await GitService.getLog(cwd, limit);
    res.json({ success: true, data: { log } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/git/branches - List branches
 */
router.get('/branches', async (req: any, res: any, next: any) => {
  try {
    const cwd = getCwd(req);
    const isRepo = await GitService.isGitRepo(cwd);
    if (!isRepo) {
      throw new AppError('NOT_GIT_REPO', '目录不是 Git 仓库', 400);
    }
    const branches = await GitService.getBranches(cwd);
    res.json({ success: true, data: { branches } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/git/commit - Commit files
 */
router.post('/commit',
  (req: any, res: any, next: any) => {
    try {
      if (!req.body.message) {
        throw new AppError('VALIDATION_ERROR', '提交信息不能为空', 400);
      }
      next();
    } catch (err) {
      next(err);
    }
  },
  async (req: any, res: any, next: any) => {
    try {
      const cwd = getCwd(req);
      const isRepo = await GitService.isGitRepo(cwd);
      if (!isRepo) {
        throw new AppError('NOT_GIT_REPO', '目录不是 Git 仓库', 400);
      }
      const result = await GitService.commit(cwd, req.body.message, req.body.files);
      res.json({ success: true, data: { message: result } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/git/checkout - Checkout branch
 */
router.post('/checkout',
  (req: any, res: any, next: any) => {
    try {
      if (!req.body.branch) {
        throw new AppError('VALIDATION_ERROR', '分支名称不能为空', 400);
      }
      next();
    } catch (err) {
      next(err);
    }
  },
  async (req: any, res: any, next: any) => {
    try {
      const cwd = getCwd(req);
      const isRepo = await GitService.isGitRepo(cwd);
      if (!isRepo) {
        throw new AppError('NOT_GIT_REPO', '目录不是 Git 仓库', 400);
      }
      const result = await GitService.checkout(cwd, req.body.branch);
      res.json({ success: true, data: { message: result } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/git/branch - Create a new branch
 */
router.post('/branch',
  (req: any, res: any, next: any) => {
    try {
      if (!req.body.name) {
        throw new AppError('VALIDATION_ERROR', '分支名称不能为空', 400);
      }
      next();
    } catch (err) {
      next(err);
    }
  },
  async (req: any, res: any, next: any) => {
    try {
      const cwd = getCwd(req);
      const isRepo = await GitService.isGitRepo(cwd);
      if (!isRepo) {
        throw new AppError('NOT_GIT_REPO', '目录不是 Git 仓库', 400);
      }
      const result = await GitService.createBranch(cwd, req.body.name);
      res.json({ success: true, data: { message: result } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/git/stage - Stage a file
 */
router.post('/stage',
  (req: any, res: any, next: any) => {
    try {
      if (!req.body.file) {
        throw new AppError('VALIDATION_ERROR', '文件路径不能为空', 400);
      }
      next();
    } catch (err) {
      next(err);
    }
  },
  async (req: any, res: any, next: any) => {
    try {
      const cwd = getCwd(req);
      const isRepo = await GitService.isGitRepo(cwd);
      if (!isRepo) {
        throw new AppError('NOT_GIT_REPO', '目录不是 Git 仓库', 400);
      }
      const result = await GitService.stageFile(cwd, req.body.file);
      res.json({ success: true, data: { message: result } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/git/unstage - Unstage a file
 */
router.post('/unstage',
  (req: any, res: any, next: any) => {
    try {
      if (!req.body.file) {
        throw new AppError('VALIDATION_ERROR', '文件路径不能为空', 400);
      }
      next();
    } catch (err) {
      next(err);
    }
  },
  async (req: any, res: any, next: any) => {
    try {
      const cwd = getCwd(req);
      const isRepo = await GitService.isGitRepo(cwd);
      if (!isRepo) {
        throw new AppError('NOT_GIT_REPO', '目录不是 Git 仓库', 400);
      }
      const result = await GitService.unstageFile(cwd, req.body.file);
      res.json({ success: true, data: { message: result } });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
