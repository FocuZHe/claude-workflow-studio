const express = require('express');
const router = express.Router();
const ChatService = require('../services/ChatService');
const { AppError } = require('../middleware/errorHandler');
const { requireFields, validateString, validateEnum, validatePagination, validate } = require('../middleware/validation');

/**
 * GET /api/chat/search - Search chat session content
 */
router.get('/search', (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.json({ success: true, data: [] });
    }

    const ChatSessionModel = require('../models/ChatSession');
    const sessions = ChatSessionModel.findAll({ limit: 99999 });
    const results = [];

    for (const session of (sessions.items || sessions)) {
      const messages = session.messages || [];
      const matches = [];

      for (const msg of messages) {
        if (msg.content && msg.content.toLowerCase().includes(q.toLowerCase())) {
          matches.push({
            role: msg.role,
            content: msg.content.substring(0, 200),
            timestamp: msg.timestamp
          });
        }
      }

      if (matches.length > 0 || (session.title || '').toLowerCase().includes(q.toLowerCase())) {
        results.push({
          id: session.id,
          title: session.title || '未命名会话',
          matchCount: matches.length,
          matches: matches.slice(0, 3),
          lastMessage: messages.length > 0 ? messages[messages.length - 1].content?.substring(0, 100) : ''
        });
      }
    }

    results.sort((a, b) => b.matchCount - a.matchCount);

    res.json({ success: true, data: results });
  } catch (err) { next(err); }
});

/**
 * POST /api/chat - Create chat session
 */
router.post('/',
  validate(
    validateString('title', 0, 200),
    validateString('systemPrompt', 0, 5000)
  ),
  (req, res, next) => {
    try {
      const session = ChatService.createSession(req.body);
      res.status(201).json({ success: true, data: session });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/chat - List chat sessions
 */
router.get('/',
  validatePagination,
  (req, res, next) => {
    try {
      const { status, search, page, limit } = req.query;
      const result = ChatService.getSessions({ status, search, page, limit });
      res.json({
        success: true,
        data: { items: result.items, total: result.total, page: result.page, limit: result.limit }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/chat/slash-commands - List available slash commands
 */
router.post('/slash-commands', (req, res) => {
  res.json({ success: true, data: ChatService.SLASH_COMMANDS });
});

/**
 * GET /api/chat/:id - Get session with messages
 */
router.get('/:id', (req, res, next) => {
  try {
    const session = ChatService.getSession(req.params.id);
    res.json({ success: true, data: session });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/chat/:id - Update session properties
 */
router.put('/:id',
  validate(
    validateString('title', 0, 200),
    validateString('model', 0, 100),
    validateString('systemPrompt', 0, 5000)
  ),
  (req, res, next) => {
    try {
      const { model, systemPrompt, title } = req.body;
      const updateData = {};
      if (model !== undefined) updateData.model = model;
      if (systemPrompt !== undefined) updateData.systemPrompt = systemPrompt;
      if (title !== undefined) updateData.title = title;
      const updated = ChatService.updateSession(req.params.id, updateData);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/chat/:id - Delete session
 */
router.delete('/:id', (req, res, next) => {
  try {
    ChatService.deleteSession(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chat/:id/messages - Send a message
 */
router.post('/:id/messages',
  validate(requireFields(['content'])),
  async (req, res, next) => {
    try {
      const result = await ChatService.sendMessage(req.params.id, req.body.content);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/chat/:id/archive - Archive session
 */
router.post('/:id/archive', (req, res, next) => {
  try {
    const session = ChatService.archiveSession(req.params.id);
    res.json({ success: true, data: session });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chat/:id/execute - Execute a confirmed action
 */
router.post('/:id/execute',
  async (req, res, next) => {
    try {
      const { actionId, confirmed, type, data } = req.body;

      // Client sends actionId + confirmed (from WebSocket confirmAction event)
      // If not confirmed, just acknowledge
      if (confirmed === false) {
        ChatService.addSystemMessage(req.params.id, '[Action] 用户拒绝了操作');
        return res.json({ success: true, data: { rejected: true } });
      }

      // Execute the action using the data from the client
      if (type && data) {
        const result = await ChatService.executeConfirmedAction(req.params.id, { type, ...data });
        return res.json({ success: true, data: result });
      }

      // Fallback: accept body as action directly
      const result = await ChatService.executeConfirmedAction(req.params.id, req.body);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
