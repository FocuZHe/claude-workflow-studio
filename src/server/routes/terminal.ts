const express = require('express');
const router = express.Router();
const TerminalService = require('../services/TerminalService');
const { AppError } = require('../middleware/errorHandler');

/**
 * POST /api/terminal - Create terminal session
 */
router.post('/', (req: any, res: any, next: any) => {
  try {
    const { cwd } = req.body;
    const session = TerminalService.createSession(cwd);
    res.status(201).json({ success: true, data: session });
  } catch (err) {
    if (err.code === 'LIMIT_EXCEEDED') {
      return res.status(429).json({ success: false, error: { code: 'LIMIT_EXCEEDED', message: err.message } });
    }
    next(err);
  }
});

/**
 * POST /api/terminal/restore - Restore terminal sessions after server restart
 * Accepts array of { title, cwd } and creates new sessions for each.
 */
router.post('/restore', (req: any, res: any, next: any) => {
  try {
    const { sessions } = req.body;
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const restored: any[] = [];
    for (const s of sessions.slice(0, 10)) { // max 10 at once
      const savedData = TerminalService._loadSessionFromDisk(s.cwd);
      const session = TerminalService.createSession(s.cwd, savedData);
      restored.push({ ...session, title: s.title || '终端' });
    }
    res.json({ success: true, data: restored });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/terminal - List active sessions
 */
router.get('/', (req: any, res: any, next: any) => {
  try {
    const sessions = TerminalService.getSessions();
    res.json({ success: true, data: sessions });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/terminal/:id - Kill terminal session
 */
router.delete('/:id', (req: any, res: any, next: any) => {
  try {
    const killed = TerminalService.killSession(req.params.id);
    if (!killed) {
      throw new AppError('NOT_FOUND', `Terminal session '${req.params.id}' not found`, 404);
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/terminal/:id/history - Get command history
 */
router.get('/:id/history', (req: any, res: any, next: any) => {
  try {
    const session = TerminalService.getSession(req.params.id);
    if (!session) {
      throw new AppError('NOT_FOUND', `Terminal session '${req.params.id}' not found`, 404);
    }
    res.json({ success: true, data: session.history || [] });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/terminal/:id/input - Send input to terminal
 */
router.post('/:id/input', (req: any, res: any, next: any) => {
  try {
    const { data } = req.body;
    if (data === undefined || data === null) {
      throw new AppError('VALIDATION_ERROR', '输入数据不能为空', 400);
    }

    const sent = TerminalService.writeInput(req.params.id, data);
    if (!sent) {
      throw new AppError('NOT_FOUND', `Terminal session '${req.params.id}' not found or not running`, 404);
    }
    res.json({ success: true, data: { sent: true } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/terminal/:id/resize - Resize terminal
 */
router.post('/:id/resize', (req: any, res: any, next: any) => {
  try {
    const { cols, rows } = req.body;
    const resized = TerminalService.resizeSession(req.params.id, cols, rows);
    if (!resized) {
      throw new AppError('NOT_FOUND', `Terminal session '${req.params.id}' not found or not running`, 404);
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/terminal/:id/output - Get buffered output
 */
router.get('/:id/output', (req: any, res: any, next: any) => {
  try {
    const output = TerminalService.getOutput(req.params.id);
    if (output === null) {
      throw new AppError('NOT_FOUND', `Terminal session '${req.params.id}' not found`, 404);
    }
    res.json({ success: true, data: { output } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
