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
savedSessions.forEach((session: any) => {
  chatSessions.set(session.id, session);
});

/**
 * ChatSession Model - In-memory CRUD operations
 */
class ChatSessionModel {
  static _persistPending: boolean = false;

  static create(data: any): any {
    const now = new Date();
    const session: any = {
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

  static findAll({ status, search, page = 1, limit = 20 }: any = {}): any {
    let results = Array.from(chatSessions.values());

    if (status) results = results.filter((s: any) => s.status === status);
    if (search) {
      const q = search.toLowerCase();
      results = results.filter((s: any) =>
        s.title.toLowerCase().includes(q) ||
        s.messages.some((m: any) => m.content.toLowerCase().includes(q))
      );
    }

    results.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const total = results.length;
    const start = (page - 1) * limit;
    const paginated = results.slice(start, start + limit);

    return {
      items: paginated.map((s: any) => ({ ...s })),
      total,
      page,
      limit
    };
  }

  static findById(id: string): any {
    const session = chatSessions.get(id);
    return session ? { ...session } : null;
  }

  static addMessage(sessionId: string, message: any): any {
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

  static update(id: string, data: any): any {
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

  static delete(id: string): boolean {
    const session = chatSessions.get(id);
    if (!session) return false;
    chatSessions.delete(id);
    this._persist();
    return true;
  }

  static exists(id: string): boolean {
    return chatSessions.has(id);
  }

  static _persist(): void {
    if (this._persistPending) return;
    this._persistPending = true;
    setImmediate(() => {
      this._doPersist();
    });
  }

  static _flush(): void {
    if (!this._persistPending) return;
    this._persistPending = false;
    this._doPersistSync();
  }

  static async _doPersist(): Promise<void> {
    this._persistPending = false;
    const data = Array.from(chatSessions.values());
    const globalItems = data.filter((s: any) => !s.workspaceId);
    const wsItems = data.filter((s: any) => s.workspaceId);

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
    } catch (e: any) {
      const logger = require('../utils/logger');
      logger.error(`Failed to persist global chat sessions: ${e.message}`);
    }
  }

  static _doPersistSync(): void {
    this._persistPending = false;
    const data = Array.from(chatSessions.values());
    const globalItems = data.filter((s: any) => !s.workspaceId);
    const wsItems = data.filter((s: any) => s.workspaceId);

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
    } catch (e: any) {
      const logger = require('../utils/logger');
      logger.error(`Failed to persist global chat sessions: ${e.message}`);
    }
  }

  static clear(): void {
    chatSessions.clear();
  }

  static reload(sessionArray: any[]): void {
    if (!Array.isArray(sessionArray)) return;
    for (const session of sessionArray) {
      if (session && session.id) {
        chatSessions.set(session.id, session);
      }
    }
  }

  static count(): number {
    return chatSessions.size;
  }
}

ChatSessionModel._persistPending = false;

module.exports = ChatSessionModel;
