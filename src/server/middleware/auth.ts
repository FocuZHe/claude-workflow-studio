const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

const API_KEY_FILE = path.join(config.data.dir, 'api-key.json');

function loadOrCreateApiKey(): string | null {
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
  } catch (e: any) {
    logger.warn(`Failed to load API key file: ${e.message}`);
  }

  // No key found and no env var set — authentication is disabled
  logger.info('No API key configured, authentication disabled');
  return null;
}

// 每次请求动态读取密钥，支持运行时修改
function getApiKey(): string | null {
  return loadOrCreateApiKey();
}

/**
 * Paths that should be excluded from authentication
 */
const SKIP_PATHS = [
  '/api/health',
  '/api/auth/key',
];

/**
 * Check if a path should skip auth (static files, health check, WebSocket)
 */
function shouldSkip(reqPath: string): boolean {
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
function authMiddleware(req: any, res: any, next: any): void {
  if (shouldSkip(req.path)) {
    return next();
  }

  // 动态读取密钥，支持运行时修改
  const currentKey = getApiKey();

  // If no API key is configured, allow all requests
  if (!currentKey) {
    return next();
  }

  const providedKey = req.headers['x-api-key'] || req.query.api_key;

  if (!providedKey) {
    res.status(401).json({
      success: false,
      error: {
        code: 'MISSING_API_KEY',
        message: '缺少 API Key，请在请求头 X-API-Key 或查询参数 api_key 中提供'
      }
    });
    return;
  }

  if (providedKey !== currentKey) {
    res.status(403).json({
      success: false,
      error: {
        code: 'INVALID_API_KEY',
        message: 'API Key 无效'
      }
    });
    return;
  }

  next();
}

module.exports = { authMiddleware, getApiKey };
