const pty = require('node-pty');
const fs = require('fs');
const path = require('path');
const { generateId } = require('../utils/id');
const logger = require('../utils/logger');

/**
 * Terminal service - manages PTY terminal sessions
 * Uses node-pty for proper pseudo-terminal support.
 */
class TerminalService {
  /** @type {import('./BroadcastService')|null} */
  static _broadcastService = null;

  /** @type {Map<string, object>} Active terminal sessions */
  static _sessions = new Map();

  /** Debounce timer for periodic save */
  static _saveTimer = null;

  /**
   * Get the directory for persisting terminal session data.
   * Uses workspace root if available, otherwise global data dir.
   */
  static _getTerminalsDir() {
    try {
      const FileService = require('./FileService');
      const wsRoot = FileService.runtimeWorkspaceRoot;
      if (wsRoot) {
        return path.join(wsRoot, 'WORKFLOWS', 'terminals');
      }
    } catch (e) { /* ignore */ }
    const config = require('../config');
    return path.join(config.data.dir, 'terminals');
  }

  /**
   * Save a single session's output and history to disk.
   */
  static _saveSessionToDisk(session) {
    try {
      const dir = this._getTerminalsDir();
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const safeName = Buffer.from(session.cwd || 'default').toString('base64')
        .replace(/[/\\+=]/g, '_');
      const filePath = path.join(dir, `${safeName}.json`);
      const data = {
        cwd: session.cwd,
        outputBuffer: session.outputBuffer.slice(-500),
        history: session.history.slice(-100),
        createdAt: session.createdAt,
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      // Non-critical, silently ignore
    }
  }

  /**
   * Load saved session data from disk by cwd.
   */
  static _loadSessionFromDisk(cwd) {
    try {
      const dir = this._getTerminalsDir();
      if (!fs.existsSync(dir)) return null;
      const safeName = Buffer.from(cwd || 'default').toString('base64')
        .replace(/[/\\+=]/g, '_');
      const filePath = path.join(dir, `${safeName}.json`);
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  /**
   * Schedule a periodic save of all active terminal sessions.
   */
  static _schedulePersist() {
    if (this._saveTimer) return;
    this._saveTimer = setInterval(() => {
      for (const session of this._sessions.values()) {
        if (session.status === 'running') {
          this._saveSessionToDisk(session);
        }
      }
    }, 5000);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  /**
   * Flush all terminal sessions to disk immediately (for graceful shutdown).
   */
  static _flushAll() {
    if (this._saveTimer) {
      clearInterval(this._saveTimer);
      this._saveTimer = null;
    }
    for (const session of this._sessions.values()) {
      if (session.status === 'running') {
        this._saveSessionToDisk(session);
      }
    }
  }

  /**
   * Initialize with BroadcastService dependency
   * @param {import('./BroadcastService')} broadcastService
   */
  static init(broadcastService) {
    TerminalService._broadcastService = broadcastService;
  }

  /**
   * Create a new terminal session
   * @param {string} [cwd] - Working directory
   * @returns {object} Session info
   */
  static createSession(cwd, restoreData = null) {
    const MAX_SESSIONS = 10;
    if (TerminalService._sessions.size >= MAX_SESSIONS) {
      const err = new Error(`Terminal session limit reached (${MAX_SESSIONS}). Close an existing session first.`);
      err.code = 'LIMIT_EXCEEDED';
      throw err;
    }

    const sessionId = generateId();
    const shellCmd = process.platform === 'win32' ? 'cmd.exe' : 'bash';
    const shellArgs = [];
    const cols = 80;
    const rows = 30;

    // Default to current workspace root if no cwd specified
    const FileService = require('./FileService');
    const defaultCwd = cwd || FileService.getWorkspaceRoot() || process.cwd();

    const ptyProcess = pty.spawn(shellCmd, shellArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: defaultCwd,
      env: { ...process.env, TERM: 'xterm-256color' }
    });

    // Restore saved output and history if available
    const savedOutput = restoreData?.outputBuffer || [];
    const savedHistory = restoreData?.history || [];

    const session = {
      id: sessionId,
      pid: ptyProcess.pid,
      cwd: defaultCwd,
      status: 'running',
      outputBuffer: [...savedOutput],
      process: ptyProcess,
      createdAt: restoreData?.createdAt || new Date(),
      history: [...savedHistory],
      currentLine: ''
    };

    // Command history methods
    session.addToHistory = function(command) {
      if (command && command.trim()) {
        this.history.push({
          command: command.trim(),
          timestamp: new Date().toISOString()
        });
        if (this.history.length > 100) {
          this.history = this.history.slice(-100);
        }
      }
    };

    session.getHistory = function() {
      return this.history;
    };

    this._sessions.set(sessionId, session);
    this._schedulePersist();

    // Handle PTY data output (combines stdout and stderr)
    ptyProcess.onData((data) => {
      session.outputBuffer.push(data);
      // Keep only last 500 lines worth of output
      if (session.outputBuffer.length > 500) {
        session.outputBuffer = session.outputBuffer.slice(-500);
      }
      if (this._broadcastService) {
        this._broadcastService.broadcast('terminal.output', {
          sessionId,
          data,
          stream: 'stdout'
        });
      }
    });

    // Handle process exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      session.status = 'exited';
      session.exitCode = exitCode;
      session.exitSignal = signal;
      // Save session data before auto-cleanup
      TerminalService._saveSessionToDisk(session);
      if (this._broadcastService) {
        this._broadcastService.broadcast('terminal.exit', {
          sessionId,
          code: exitCode,
          signal
        });
      }
      // Auto-remove exited session after 5 minutes (keeps slot available)
      setTimeout(() => {
        if (TerminalService._sessions.has(sessionId)) {
          const s = TerminalService._sessions.get(sessionId);
          if (s && s.status === 'exited') {
            TerminalService._sessions.delete(sessionId);
            logger.info(`Auto-cleaned exited terminal session: ${sessionId}`);
          }
        }
      }, 5 * 60 * 1000);
    });

    logger.info(`Terminal session created: ${sessionId} (pid: ${ptyProcess.pid})`);

    return {
      id: sessionId,
      pid: ptyProcess.pid,
      cwd: session.cwd,
      status: session.status,
      createdAt: session.createdAt
    };
  }

  /**
   * Write input to a terminal session
   * @param {string} sessionId - Session ID
   * @param {string} data - Input data
   * @returns {boolean}
   */
  static writeInput(sessionId, data) {
    const session = this._sessions.get(sessionId);
    if (!session) return false;
    if (session.status !== 'running') return false;

    session.process.write(data);
    return true;
  }

  /**
   * Get buffered output for a session
   * @param {string} sessionId - Session ID
   * @returns {string|null}
   */
  static getOutput(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return null;
    return session.outputBuffer.join('');
  }

  /**
   * Kill a terminal session
   * @param {string} sessionId - Session ID
   * @returns {boolean}
   */
  static killSession(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return false;

    try {
      session.process.kill();
    } catch (err) {
      logger.error(`Failed to kill terminal session ${sessionId}: ${err.message}`);
    }

    session.status = 'killed';
    this._sessions.delete(sessionId);
    return true;
  }

  /**
   * Resize a terminal session
   * @param {string} sessionId - Session ID
   * @param {number} cols - Number of columns
   * @param {number} rows - Number of rows
   * @returns {boolean}
   */
  static resizeSession(sessionId, cols, rows) {
    const session = this._sessions.get(sessionId);
    if (!session) return false;
    if (session.status !== 'running') return false;

    try {
      session.process.resize(cols, rows);
    } catch (err) {
      logger.error(`Failed to resize terminal session ${sessionId}: ${err.message}`);
      return false;
    }
    return true;
  }

  /**
   * Get all active sessions
   * @returns {Array}
   */
  static getSessions() {
    return Array.from(this._sessions.values()).map(s => ({
      id: s.id,
      pid: s.pid,
      cwd: s.cwd,
      status: s.status,
      createdAt: s.createdAt
    }));
  }

  /**
   * Get a specific session (returns internal session object with history methods)
   * @param {string} sessionId - Session ID
   * @returns {object|null}
   */
  static getSession(sessionId) {
    return this._sessions.get(sessionId) || null;
  }

  /**
   * Get a safe public view of a session (no internal process reference)
   * @param {string} sessionId - Session ID
   * @returns {object|null}
   */
  static getSessionInfo(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return null;
    return {
      id: session.id,
      pid: session.pid,
      cwd: session.cwd,
      status: session.status,
      createdAt: session.createdAt
    };
  }
}

module.exports = TerminalService;
