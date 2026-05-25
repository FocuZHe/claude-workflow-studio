const fs = require('fs');
const path = require('path');
const { generateId } = require('../utils/id');
const config = require('../config');
const { atomicWriteSync } = require('../utils/atomicWrite');
const logger = require('../utils/logger');

const PERSIST_MAX = 1000;

/**
 * Audit logging service - tracks all mutating operations
 */
class AuditService {
  static MAX_LOGS = 10000;
  /** @type {Array<Object>} Audit log entries */
  static logs = [];

  static _getFilePath() {
    return path.join(config.data.dir, 'audit-logs.json');
  }

  /**
   * Load logs from disk on startup.
   */
  static loadFromDisk() {
    try {
      const filePath = AuditService._getFilePath();
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          AuditService.logs = parsed;
          logger.info(`Loaded ${parsed.length} audit log(s) from disk`);
        }
      }
    } catch (e) {
      logger.error(`Failed to load audit logs: ${e.message}`);
    }
  }

  /**
   * Persist logs to disk with debounce.
   */
  static _persist() {
    if (AuditService._persistPending) return;
    AuditService._persistPending = true;
    setImmediate(() => {
      AuditService._doPersist();
    });
  }

  static _doPersist() {
    AuditService._persistPending = false;
    try {
      const filePath = AuditService._getFilePath();
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Keep only the most recent PERSIST_MAX logs
      const toSave = AuditService.logs.slice(-PERSIST_MAX);
      atomicWriteSync(filePath, JSON.stringify(toSave, null, 2));
    } catch (e) {
      logger.error(`Failed to persist audit logs: ${e.message}`);
    }
  }

  /**
   * Record an audit log entry
   * @param {string} action - Action type (e.g., CREATE, UPDATE, DELETE, SET_WORKSPACE)
   * @param {string} targetType - Resource type (e.g., workflow, agent, file)
   * @param {string} targetId - Resource ID
   * @param {string} detail - Human-readable description
   * @param {string} ip - Client IP address
   */
  static log(action, targetType, targetId, detail, ip) {
    const entry = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      action,
      targetType,
      targetId,
      detail,
      ip,
      sensitive: ['DELETE', 'SET_WORKSPACE'].includes(action)
    };

    AuditService.logs.push(entry);
    if (AuditService.logs.length > AuditService.MAX_LOGS) {
      AuditService.logs = AuditService.logs.slice(-AuditService.MAX_LOGS);
    }
    AuditService._persist();
    return entry;
  }

  /**
   * Get audit logs with pagination and filters
   * @param {Object} filters - { action, targetType, sensitive, page, limit }
   * @returns {{ items: Array, total: number, page: number, limit: number }}
   */
  static getLogs(filters = {}) {
    const { action, targetType, sensitive, page = 1, limit = 20 } = filters;

    let result = [...AuditService.logs];

    if (action) {
      result = result.filter(l => l.action === action);
    }
    if (targetType) {
      result = result.filter(l => l.targetType === targetType);
    }
    if (sensitive !== undefined) {
      const isSensitive = sensitive === 'true' || sensitive === true;
      result = result.filter(l => l.sensitive === isSensitive);
    }

    // Sort by timestamp descending
    result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const total = result.length;
    const start = (page - 1) * limit;
    const paginated = result.slice(start, start + limit);

    return {
      items: paginated,
      total,
      page,
      limit
    };
  }

  /**
   * Clear all logs (for testing)
   */
  static clear() {
    AuditService.logs = [];
    AuditService._persist();
  }
}

// Initialize debounce flag
AuditService._persistPending = false;

module.exports = AuditService;
