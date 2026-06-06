const fs = require('fs');
const path = require('path');
const config = require('../config');

const LOG_LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const currentLevel: number = LOG_LEVELS[config.log.level] ?? LOG_LEVELS.info;

// 日志目录
const LOG_DIR: string = path.join(config.data.dir, '..', 'logs');
let logStream: any = null;
let currentLogDate: string | null = null;

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getLogStream(): any {
  const today = getLogDate();
  if (logStream && currentLogDate === today) return logStream;

  // 切换日期，关闭旧流
  if (logStream) {
    try { logStream.end(); } catch (_) {}
  }

  ensureLogDir();
  const logFile = path.join(LOG_DIR, `app-${today}.log`);
  logStream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf-8' });
  currentLogDate = today;
  return logStream;
}

// 启动时清理 30 天前的日志
function cleanOldLogs(): void {
  try {
    ensureLogDir();
    const files = fs.readdirSync(LOG_DIR);
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const f of files) {
      if (!f.startsWith('app-') || !f.endsWith('.log')) continue;
      const dateStr = f.slice(4, 14);
      const fileDate = new Date(dateStr).getTime();
      if (fileDate < cutoff) {
        fs.unlinkSync(path.join(LOG_DIR, f));
      }
    }
  } catch (_) {}
}

function formatMessage(level: string, message: string, meta?: any): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

function writeToFile(level: string, message: string, meta?: any): void {
  try {
    const stream = getLogStream();
    const line = formatMessage(level, message, meta) + '\n';
    stream.write(line);
  } catch (_) { /* 日志写入失败不中断程序 */ }
}

// 清理旧日志
cleanOldLogs();

const logger = {
  debug(message: string, meta?: any): void {
    if (currentLevel <= LOG_LEVELS.debug) {
      const line = formatMessage('debug', message, meta);
      console.debug(line);
      writeToFile('debug', message, meta);
    }
  },

  info(message: string, meta?: any): void {
    if (currentLevel <= LOG_LEVELS.info) {
      const line = formatMessage('info', message, meta);
      console.log(line);
      writeToFile('info', message, meta);
    }
  },

  warn(message: string, meta?: any): void {
    if (currentLevel <= LOG_LEVELS.warn) {
      const line = formatMessage('warn', message, meta);
      console.warn(line);
      writeToFile('warn', message, meta);
    }
  },

  error(message: string, meta?: any): void {
    if (currentLevel <= LOG_LEVELS.error) {
      const line = formatMessage('error', message, meta);
      console.error(line);
      writeToFile('error', message, meta);
    }
  },

  /** 关闭日志流（优雅退出时调用） */
  close(): void {
    if (logStream) {
      try { logStream.end(); } catch (_) {}
      logStream = null;
    }
  }
};

module.exports = logger;
