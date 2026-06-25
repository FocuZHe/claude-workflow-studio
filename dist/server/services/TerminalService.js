"use strict";
/**
 * TerminalService - 真正的 PTY 终端服务
 * 使用 node-pty 创建真实的 shell 进程
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalService = void 0;
const pty = require('node-pty');
const os = require('os');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');
// 终端会话持久化文件
const TERMINAL_SESSIONS_FILE = path.join(config.data.dir, 'terminal-sessions.json');
class TerminalService {
    // 会话 Map（_sessions 为公开字段，供测试清空使用）
    static _sessions = new Map();
    static broadcastService = null;
    /**
     * 设置广播服务
     */
    static setBroadcastService(bs) {
        TerminalService.broadcastService = bs;
    }
    /**
     * 获取默认 shell
     */
    static getDefaultShell() {
        if (os.platform() === 'win32') {
            return process.env.COMSPEC || 'cmd.exe';
        }
        return process.env.SHELL || '/bin/bash';
    }
    /**
     * 创建终端会话（真正的 PTY）
     */
    static createSession(cwd, savedData) {
        const shell = this.getDefaultShell();
        const cols = 80;
        const rows = 24;
        // 基础校验：cwd 必须是字符串且存在（防止崩溃）
        let resolvedCwd = cwd || os.homedir();
        if (typeof resolvedCwd !== 'string') {
            resolvedCwd = os.homedir();
        }
        else {
            try {
                const fs = require('fs');
                const path = require('path');
                const resolved = path.resolve(resolvedCwd);
                const stat = fs.statSync(resolved);
                if (!stat.isDirectory()) {
                    resolvedCwd = os.homedir();
                }
                else {
                    resolvedCwd = resolved;
                }
            }
            catch (_) {
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
            const session = {
                id: ptyProcess.pid.toString(),
                pid: ptyProcess.pid,
                name: resolvedCwd || shell,
                status: 'running',
                cwd: resolvedCwd,
                createdAt: new Date(),
                cols,
                rows,
                history: savedData?.history || [],
                outputBuffer: savedData?.outputBuffer ? [...savedData.outputBuffer] : [],
                ptyProcess,
            };
            // 监听 PTY 输出 → 广播到前端 + 缓存到 outputBuffer（供 getOutput 与持久化）
            ptyProcess.onData((data) => {
                if (TerminalService.broadcastService) {
                    TerminalService.broadcastService.broadcast('terminal.output', {
                        sessionId: session.id,
                        data,
                    });
                }
                // 缓存最近输出（上限 1000 行，防止内存膨胀）
                session.outputBuffer.push(data);
                if (session.outputBuffer.length > 1000) {
                    session.outputBuffer.shift();
                }
            });
            // 监听 PTY 退出
            ptyProcess.onExit(({ exitCode, signal }) => {
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
            this._sessions.set(session.id, session);
            logger.info(`Terminal created: ${session.id} (shell: ${shell}, cwd: ${resolvedCwd})`);
            return {
                id: session.id,
                pid: session.pid,
                name: session.name,
                cwd: session.cwd,
                status: session.status,
                createdAt: session.createdAt,
                title: path.basename(session.cwd || shell),
            };
        }
        catch (err) {
            logger.error('Failed to create terminal:', err.message);
            throw err;
        }
    }
    /**
     * 获取终端会话
     */
    static getSession(sessionId) {
        return this._sessions.get(sessionId);
    }
    /**
     * 获取所有终端会话
     */
    static getSessions() {
        return Array.from(this._sessions.values())
            .filter(s => s.status === 'running')
            .map(s => ({
            id: s.id,
            pid: s.pid,
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
    static killSession(sessionId) {
        const session = this._sessions.get(sessionId);
        if (!session)
            return false;
        if (session.ptyProcess) {
            try {
                session.ptyProcess.kill();
            }
            catch (e) { /* ignore */ }
        }
        session.status = 'inactive';
        this._sessions.delete(sessionId);
        return true;
    }
    /**
     * 写入输入到 PTY
     */
    static writeInput(sessionId, data) {
        const session = this._sessions.get(sessionId);
        if (!session || session.status !== 'running' || !session.ptyProcess)
            return false;
        try {
            session.ptyProcess.write(data);
            return true;
        }
        catch (err) {
            logger.warn(`Terminal write failed: ${err.message}`);
            return false;
        }
    }
    /**
     * 调整终端大小
     */
    static resizeSession(sessionId, cols, rows) {
        const session = this._sessions.get(sessionId);
        if (!session || session.status !== 'running' || !session.ptyProcess)
            return false;
        try {
            session.ptyProcess.resize(cols, rows);
            session.cols = cols;
            session.rows = rows;
            return true;
        }
        catch (err) {
            logger.warn(`Terminal resize failed: ${err.message}`);
            return false;
        }
    }
    /**
     * 获取输出（返回缓存的最近输出，供 REST API /api/terminal/:id/output 使用）
     */
    static getOutput(sessionId) {
        const session = this._sessions.get(sessionId);
        if (!session)
            return null;
        return Array.isArray(session.outputBuffer) ? session.outputBuffer.join('') : '';
    }
    /**
     * 保存会话到磁盘（按 cwd 索引，供重启后恢复）
     */
    static _saveSessionToDisk(session) {
        if (!session)
            return;
        try {
            const all = this._loadAllFromDisk();
            all[session.cwd] = {
                cwd: session.cwd,
                outputBuffer: Array.isArray(session.outputBuffer) ? session.outputBuffer.slice(-500) : [],
                history: Array.isArray(session.history) ? session.history.slice(-200) : [],
                createdAt: session.createdAt ? new Date(session.createdAt).toISOString() : new Date().toISOString(),
            };
            if (!fs.existsSync(config.data.dir))
                fs.mkdirSync(config.data.dir, { recursive: true });
            fs.writeFileSync(TERMINAL_SESSIONS_FILE, JSON.stringify(all, null, 2), 'utf-8');
        }
        catch (e) {
            logger.warn(`Failed to save terminal session: ${e.message}`);
        }
    }
    /**
     * 从磁盘加载指定 cwd 的会话
     */
    static _loadSessionFromDisk(cwd) {
        const all = this._loadAllFromDisk();
        const saved = all[cwd];
        if (!saved)
            return { cwd, history: [], outputBuffer: [] };
        return {
            cwd: saved.cwd || cwd,
            history: Array.isArray(saved.history) ? saved.history : [],
            outputBuffer: Array.isArray(saved.outputBuffer) ? saved.outputBuffer : [],
            createdAt: saved.createdAt,
        };
    }
    /**
     * 读取全部持久化的会话
     */
    static _loadAllFromDisk() {
        try {
            if (fs.existsSync(TERMINAL_SESSIONS_FILE)) {
                return JSON.parse(fs.readFileSync(TERMINAL_SESSIONS_FILE, 'utf-8')) || {};
            }
        }
        catch (e) {
            logger.warn(`Failed to read terminal sessions file: ${e.message}`);
        }
        return {};
    }
    /**
     * 关闭所有会话
     */
    static killAll() {
        for (const [id, session] of this._sessions) {
            if (session.ptyProcess) {
                try {
                    session.ptyProcess.kill();
                }
                catch (e) { /* ignore */ }
            }
        }
        this._sessions.clear();
    }
}
exports.TerminalService = TerminalService;
module.exports = TerminalService;
//# sourceMappingURL=TerminalService.js.map