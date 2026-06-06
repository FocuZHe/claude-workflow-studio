const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const logger = require('./logger');

/**
 * Atomic file write utilities — prevents half-written corrupted files on crash.
 * Strategy: write to .tmp → rename to target (atomic on POSIX and NTFS).
 * Backup: existing file is saved to .bak before overwrite for recovery.
 */

/**
 * Synchronous atomic write with backup.
 */
function atomicWriteSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const tmpPath = filePath + '.tmp';
  const bakPath = filePath + '.bak';

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Backup existing file
    if (fs.existsSync(filePath)) {
      try {
        fs.writeFileSync(bakPath, fs.readFileSync(filePath, 'utf-8'), 'utf-8');
      } catch (e: any) {
        logger.warn(`Failed to create backup ${bakPath}: ${e.message}`);
      }
    }

    // Atomic: write to tmp → rename to target
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    throw e;
  }
}

/**
 * Asynchronous atomic write with backup.
 */
async function atomicWriteAsync(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tmpPath = filePath + '.tmp';
  const bakPath = filePath + '.bak';

  await fsPromises.mkdir(dir, { recursive: true });

  // Backup existing file
  if (fs.existsSync(filePath)) {
    try {
      const existing = await fsPromises.readFile(filePath, 'utf-8');
      await fsPromises.writeFile(bakPath, existing, 'utf-8');
    } catch (e: any) {
      logger.warn(`Failed to create backup ${bakPath}: ${e.message}`);
    }
  }

  // Atomic: write to tmp → rename to target
  await fsPromises.writeFile(tmpPath, content, 'utf-8');
  await fsPromises.rename(tmpPath, filePath);
}

/**
 * Load data from JSON file with crash recovery.
 * Tries main file → backup file → empty state.
 */
function loadWithRecovery(filePath: string): any[] {
  const bakPath = filePath + '.bak';

  const tryParse = (fPath: string): any[] | null => {
    try {
      if (!fs.existsSync(fPath)) return null;
      const raw = fs.readFileSync(fPath, 'utf-8');
      return JSON.parse(raw);
    } catch (e: any) {
      logger.error(`Corrupted file ${fPath}: ${e.message}`);
      return null;
    }
  };

  const data = tryParse(filePath);
  if (data !== null) return data;

  logger.warn(`Recovering from backup ${bakPath}`);
  const backup = tryParse(bakPath);
  if (backup !== null) {
    // Restore backup to main
    try {
      atomicWriteSync(filePath, JSON.stringify(backup, null, 2));
      logger.info(`Recovered ${filePath} from backup`);
    } catch (e: any) {
      logger.error(`Failed to restore backup: ${e.message}`);
    }
    return backup;
  }

  logger.warn(`No valid data for ${filePath}, starting empty`);
  return [];
}

module.exports = { atomicWriteSync, atomicWriteAsync, loadWithRecovery };
