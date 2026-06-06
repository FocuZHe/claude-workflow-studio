"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
    }
    catch (e) {
        logger.warn(`Failed to load API key file: ${e.message}`);
    }
    // No key found and no env var set — authentication is disabled
    logger.info('No API key configured, authentication disabled');
    return null;
}
const apiKey = loadOrCreateApiKey();
if (apiKey) {
    logger.info(`API key authentication is ENABLED. Key: ${apiKey.substring(0, 8)}...`);
}
else {
    logger.info('API key authentication is DISABLED (no key configured)');
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
function shouldSkip(reqPath) {
    if (SKIP_PATHS.includes(reqPath))
        return true;
    // Skip non-API paths (static files, SPA fallback, etc.)
    if (!reqPath.startsWith('/api/'))
        return true;
    // Skip WebSocket upgrade requests
    if (reqPath === '/ws')
        return true;
    return false;
}
/**
 * Express middleware that validates the API key.
 */
function authMiddleware(req, res, next) {
    if (shouldSkip(req.path)) {
        return next();
    }
    // If no API key is configured, allow all requests
    if (!apiKey) {
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
    if (providedKey !== apiKey) {
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
/**
 * Return the current API key (for frontend initial setup).
 */
function getApiKey() {
    return apiKey;
}
module.exports = { authMiddleware, getApiKey };
//# sourceMappingURL=auth.js.map