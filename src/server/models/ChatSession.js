const path = require('path');
const fs = require('fs');
const { generateId } = require('../utils/id');
const config = require('../config');
const DataStore = require('../utils/DataStore');
const { atomicWriteSync, atomicWriteAsync } = require('../utils/atomicWrite');

// DataStore for persistence
const dataStore = new DataStore(
  path.join(config.data.dir, config.data.chatSessionsFile)
);

// In-memory store, loaded from file on startup
const chatSessions = new Map();
const savedSessions = dataStore.load();
savedSessions.forEach(session => {
  chatSessions.set(session.id, session);
});

/**
 * ChatSession Model - In-memory CRUD operations
 */
class ChatSessionModel {
  /**
   * Create a new chat session
   */
  static create(data) {
    const now = new Date();
    const session = {
      id: generateId(),
      title: data.title || 'New Chat',
      workspaceId: data.workspaceId !== undefined ? data.workspaceId : null,
      messages: [],
      model: data.model || 'haiku',
      systemPrompt: data.systemPrompt || '',
      status: 'active',
      contextConfig: data.contextConfig || {
        maxMessages: 20,
        maxTokens: 100000,
        summarizeOld: true
      },
      createdAt: now,
      updatedAt: now
    };
    chatSessions.set(session.id, session);
    this._persist();
    return { ...session };
  }

  /**
   * Find all chat sessions with optional filters
   */
  static findAll({ status, search, page = 1, limit = 20 } = {}) {
    let results = Array.from(chatSessions.values());

    if (status) {
      results = results.filter(s => s.status === status);
    }
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.messages.some(m => m.content.toLowerCase().includes(q))
      );
    }

    // Sort by last updated descending
    results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    const total = results.length;
    const start = (page - 1) * limit;
    const paginated = results.slice(start, start + limit);

    return {
      items: paginated.map(s => ({ ...s })),
      total,
      page,
      limit
    };
  }

  /**
   * Find chat session by ID
   */
  static findById(id) {
    const session = chatSessions.get(id);
    return session ? { ...session } : null;
  }

  /**
   * Add a message to a chat session
   */
  static addMessage(sessionId, message) {
    const session = chatSessions.get(sessionId);
    if (!session) return null;

    const msg = {
      id: generateId(),
      role: message.role,
      content: message.content,
      timestamp: new Date(),
      metadata: message.metadata || {}
    };
    session.messages.push(msg);
    session.updatedAt = new Date();
    this._persist();
    return { ...msg };
  }

  /**
   * Update chat session
   */
  static update(id, data) {
    const session = chatSessions.get(id);
    if (!session) return null;

    if (data.title !== undefined) session.title = data.title;
    if (data.model !== undefined) session.model = data.model;
    if (data.systemPrompt !== undefined) session.systemPrompt = data.systemPrompt;
    if (data.status !== undefined) session.status = data.status;
    if (data.messages !== undefined) session.messages = data.messages;
    if (data.contextConfig !== undefined) session.contextConfig = data.contextConfig;
    session.updatedAt = new Date();
    this._persist();

    return { ...session };
  }

  /**
   * Delete chat session
   */
  static delete(id) {
    const session = chatSessions.get(id);
    if (!session) return false;
    chatSessions.delete(id);
    this._persist();
    return true;
  }

  /**
   * Check if session exists
   */
  static exists(id) {
    return chatSessions.has(id);
  }

  /**
   * Persist current data to file.
   */
  static _persist() {
    if (this._persistPending) return;
    this._persistPending = true;
    setImmediate(() => {
      this._doPersist();
    });
  }

  static _flush() {
    if (!this._persistPending) return;
    this._persistPending = false;
    this._doPersistSync();
  }

  static async _doPersist() {
    this._persistPending = false;
    const data = Array.from(chatSessions.values());
    const globalItems = data.filter(s => !s.workspaceId);
    const wsItems = data.filter(s => s.workspaceId);

    try {
      const FileService = require('../services/FileService');
      const workspaceRoot = FileService.runtimeWorkspaceRoot;
      if (workspaceRoot) {
        const filePath = path.join(workspaceRoot, 'WORKFLOWS', 'chat-sessions.json');
        await atomicWriteAsync(filePath, JSON.stringify(wsItems, null, 2));
      }
    } catch (e) {
      // Fall through to global persistence
    }
    try {
      dataStore.saveAsync(globalItems);
    } catch (e) {
      const logger = require('../utils/logger');
      logger.error(`Failed to persist global chat sessions: ${e.message}`);
    }
  }

  static _doPersistSync() {
    this._persistPending = false;
    const data = Array.from(chatSessions.values());
    const globalItems = data.filter(s => !s.workspaceId);
    const wsItems = data.filter(s => s.workspaceId);

    try {
      const FileService = require('../services/FileService');
      const workspaceRoot = FileService.runtimeWorkspaceRoot;
      if (workspaceRoot) {
        const filePath = path.join(workspaceRoot, 'WORKFLOWS', 'chat-sessions.json');
        atomicWriteSync(filePath, JSON.stringify(wsItems, null, 2));
      }
    } catch (e) {
      // Fall through to global persistence
    }
    try {
      dataStore.save(globalItems);
    } catch (e) {
      const logger = require('../utils/logger');
      logger.error(`Failed to persist global chat sessions: ${e.message}`);
    }
  }

  /**
   * Clear all sessions (for testing)
   */
  static clear() {
    chatSessions.clear();
  }

  static reload(sessionArray) {
    if (!Array.isArray(sessionArray)) return;
    for (const session of sessionArray) {
      if (session && session.id) {
        chatSessions.set(session.id, session);
      }
    }
  }

  static count() {
    return chatSessions.size;
  }
}

ChatSessionModel._persistPending = false;

module.exports = ChatSessionModel;
