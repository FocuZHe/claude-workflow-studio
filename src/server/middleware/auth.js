/**
 * API Key authentication middleware
 *
 * Behavior:
 * - On first startup, auto-generates a random API key and saves to data/api-key.json.
 * - On subsequent startups, loads the key from data/api-key.json.
 * - If API_KEY env var is set, it overrides the auto-generated key.
 * - Requests must include the key via:
 *   - `X-API-Key` header, or
 *   - `?api_key=<key>` query parameter
 * - Health check endpoint (/api/health) is always skipped.
 * - Static file requests are always skipped.
 * - /api/auth/key endpoint is skipped (for initial key retrieval).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

const API_KEY_FILE = path.join(config.data.dir, 'api-key.json');

function loadOrCreateApiKey() {
  // Env var overrides everything
  if (process.env.API_KEY) {
    return process.env.API_KEY;
  }

  // Try loading from file
  try {
    if (fs.existsSync(API_KEY_FILE)) {
      const data = JSON.parse(fs.readFileSync(API_KEY_FILE, 'utf-8'));
      if (data && data.apiKey) {
        logger.info('API key loaded from data/api-key.json');
        return data.apiKey;
      }
    }
  } catch (e) {
    logger.warn(`Failed to load API key file: ${e.message}`);
  }

  // Generate new key
  const apiKey = crypto.randomBytes(32).toString('hex');
  try {
    const dir = path.dirname(API_KEY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(API_KEY_FILE, JSON.stringify({ apiKey }, null, 2), 'utf-8');
    logger.info('Auto-generated API key saved to data/api-key.json');
  } catch (e) {
    logger.error(`Failed to save API key file: ${e.message}`);
  }

  return apiKey;
}

const apiKey = loadOrCreateApiKey();
logger.info(`API key authentication is ENABLED. Key: ${apiKey.substring(0, 8)}...`);

/**
 * Paths that should be excluded from authentication
 */
const SKIP_PATHS = [
  '/api/health',
  '/api/auth/key',
];

/**
 * Check if a path should skip auth (static files, health check, WebSocket)
 * @param {string} reqPath - The request path
 * @returns {boolean}
 */
function shouldSkip(reqPath) {
  if (SKIP_PATHS.includes(reqPath)) return true;

  // Skip non-API paths (static files, SPA fallback, etc.)
  if (!reqPath.startsWith('/api/')) return true;

  // Skip WebSocket upgrade requests
  if (reqPath === '/ws') return true;

  return false;
}

/**
 * Express middleware that validates the API key.
 */
function authMiddleware(req, res, next) {
  if (shouldSkip(req.path)) {
    return next();
  }

  const providedKey = req.headers['x-api-key'] || req.query.api_key;

  if (!providedKey) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'MISSING_API_KEY',
        message: '缺少 API Key，请在请求头 X-API-Key 或查询参数 api_key 中提供'
      }
    });
  }

  if (providedKey !== apiKey) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'INVALID_API_KEY',
        message: 'API Key 无效'
      }
    });
  }

  next();
}

/**
 * Return the current API key (for frontend initial setup).
 * This endpoint itself is excluded from auth (in SKIP_PATHS).
 */
function getApiKey() {
  return apiKey;
}

module.exports = { authMiddleware, getApiKey };
