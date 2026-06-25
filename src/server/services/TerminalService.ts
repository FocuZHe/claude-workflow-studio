/**
 * TerminalService - 真正的 PTY 终端服务
 * 使用 node-pty 创建真实的 shell 进程
 */

const pty = require('node-pty');
const os = require('os');
const path = require('path');
const logger = require('../utils/logger');

export interface TerminalSession {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  cwd: string;
  createdAt: Date;
  cols: number;
  rows: number;
  history: string[];
}

export class TerminalService {
  private static sessions: Map<string, any> = new Map();
  private static broadcastService: any = null;

  /**
   * 设置广播服务
   */
  static setBroadcastService(bs: any): void {
    TerminalService.broadcastService = bs;
  }

  /**
   * 获取默认 shell
   */
  private static getDefaultShell(): string {
    if (os.platform() === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  /**
   * 创建终端会话（真正的 PTY）
   */
  static createSession(cwd: string, savedData?: any): any {
    const shell = this.getDefaultShell();
    const cols = 80;
    const rows = 24;

    // 基础校验：cwd 必须是字符串且存在（防止崩溃）
    let resolvedCwd: string = cwd || os.homedir();
    if (typeof resolvedCwd !== 'string') {
      resolvedCwd = os.homedir();
    } else {
      try {
        const fs = require('fs');
        const path = require('path');
        const resolved = path.resolve(resolvedCwd);
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) {
          resolvedCwd = os.homedir();
        } else {
          resolvedCwd = resolved;
        }
      } catch (_) {
        resolvedCwd = os.homedir();
      }
    }

    try {
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: resolvedCwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      const session: any = {
        id: ptyProcess.pid.toString(),
        name: resolvedCwd || shell,
        status: 'active',
        cwd: resolvedCwd,
        createdAt: new Date(),
        cols,
        rows,
        history: savedData?.history || [],
        ptyProcess,
      };

      // 监听 PTY 输出 → 广播到前端
      ptyProcess.onData((data: string) => {
        if (TerminalService.broadcastService) {
          TerminalService.broadcastService.broadcast('terminal.output', {
            sessionId: session.id,
            data,
          });
        }
      });

      // 监听 PTY 退出
      ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
        session.status = 'inactive';
        if (TerminalService.broadcastService) {
          TerminalService.broadcastService.broadcast('terminal.exit', {
            sessionId: session.id,
            code: exitCode,
            signal,
          });
        }
        logger.info(`Terminal ${session.id} exited (code: ${exitCode})`);
      });

      this.sessions.set(session.id, session);
      logger.info(`Terminal created: ${session.id} (shell: ${shell}, cwd: ${resolvedCwd})`);

      return {
        id: session.id,
        name: session.name,
        cwd: session.cwd,
        status: session.status,
        createdAt: session.createdAt,
        title: path.basename(session.cwd || shell),
      };
    } catch (err: any) {
      logger.error('Failed to create terminal:', err.message);
      throw err;
    }
  }

  /**
   * 获取终端会话
   */
  static getSession(sessionId: string): any {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取所有终端会话
   */
  static getSessions(): any[] {
    return Array.from(this.sessions.values())
      .filter(s => s.status === 'active')
      .map(s => ({
        id: s.id,
        name: s.name,
        cwd: s.cwd,
        status: s.status,
        createdAt: s.createdAt,
        title: path.basename(s.cwd || s.name),
      }));
  }

  /**
   * 关闭终端会话
   */
  static killSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.ptyProcess) {
      try {
        session.ptyProcess.kill();
      } catch (e) { /* ignore */ }
    }
    session.status = 'inactive';
    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * 写入输入到 PTY
   */
  static writeInput(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'active' || !session.ptyProcess) return false;

    try {
      session.ptyProcess.write(data);
      return true;
    } catch (err: any) {
      logger.warn(`Terminal write failed: ${err.message}`);
      return false;
    }
  }

  /**
   * 调整终端大小
   */
  static resizeSession(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'active' || !session.ptyProcess) return false;

    try {
      session.ptyProcess.resize(cols, rows);
      session.cols = cols;
      session.rows = rows;
      return true;
    } catch (err: any) {
      logger.warn(`Terminal resize failed: ${err.message}`);
      return false;
    }
  }

  /**
   * 获取输出（PTY 模式下不需要，输出通过 WebSocket 推送）
   */
  static getOutput(sessionId: string): string | null {
    return null;
  }

  /**
   * 从磁盘加载会话
   */
  static _loadSessionFromDisk(cwd: string): any {
    return { cwd, history: [] };
  }

  /**
   * 关闭所有会话
   */
  static killAll(): void {
    for (const [id, session] of this.sessions) {
      if (session.ptyProcess) {
        try { session.ptyProcess.kill(); } catch (e) { /* ignore */ }
      }
    }
    this.sessions.clear();
  }
}

module.exports = TerminalService;
