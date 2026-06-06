"use strict";
/**
 * Safety middleware - provides security-related middleware functions
 * for rate limiting, input sanitization, threat detection, and security headers
 */
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Rate limiting middleware - limits requests per IP within a time window
 */
function rateLimit(options = {}) {
    const { windowMs = 60000, max = 100, message = 'Too many requests, please try again later' } = options;
    const store = new Map();
    let cleanupInterval = null;
    // Cleanup expired records periodically
    function cleanup() {
        const now = Date.now();
        for (const [ip, record] of store.entries()) {
            if (now > record.resetTime) {
                store.delete(ip);
            }
        }
    }
    // Start cleanup interval
    if (!cleanupInterval) {
        cleanupInterval = setInterval(cleanup, windowMs);
        cleanupInterval.unref(); // Don't prevent process exit
    }
    return (req, res, next) => {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const now = Date.now();
        let record = store.get(ip);
        if (!record || now > record.resetTime) {
            record = {
                count: 1,
                resetTime: now + windowMs
            };
            store.set(ip, record);
        }
        else {
            record.count++;
        }
        // Set rate limit headers
        res.set('X-RateLimit-Limit', String(max));
        res.set('X-RateLimit-Remaining', String(Math.max(0, max - record.count)));
        res.set('X-RateLimit-Reset', String(Math.ceil(record.resetTime / 1000)));
        if (record.count > max) {
            return res.status(429).json({
                success: false,
                error: {
                    code: 'RATE_LIMIT_EXCEEDED',
                    message
                }
            });
        }
        next();
    };
}
/**
 * Sanitize input middleware - removes XSS threats from request data
 */
function sanitizeInput() {
    function sanitizeString(value) {
        if (typeof value !== 'string')
            return value;
        let sanitized = value.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        sanitized = sanitized.replace(/\bon\w+\s*=/gi, '');
        sanitized = sanitized.replace(/javascript\s*:/gi, '');
        sanitized = sanitized.replace(/vbscript\s*:/gi, '');
        sanitized = sanitized.replace(/data\s*:/gi, '');
        return sanitized;
    }
    function sanitizeObject(obj) {
        if (obj === null || obj === undefined)
            return obj;
        if (typeof obj === 'string')
            return sanitizeString(obj);
        if (Array.isArray(obj))
            return obj.map(sanitizeObject);
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                sanitized[key] = sanitizeString(value);
            }
            else if (typeof value === 'object' && value !== null) {
                sanitized[key] = sanitizeObject(value);
            }
            else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }
    return (req, res, next) => {
        if (req.body && typeof req.body === 'object') {
            req.body = sanitizeObject(req.body);
        }
        if (req.query && typeof req.query === 'object') {
            req.query = sanitizeObject(req.query);
        }
        if (req.params && typeof req.params === 'object') {
            req.params = sanitizeObject(req.params);
        }
        next();
    };
}
/**
 * Threat detection middleware - detects common attack patterns
 */
function detectThreats() {
    const threatPatterns = {
        sqlInjection: {
            patterns: [
                /union\s+select/gi,
                /drop\s+table/gi,
                /insert\s+into/gi,
                /delete\s+from/gi,
                /update\s+\w+\s+set/gi,
                /;\s*--/,
                /'\s*or\s+'[0-9]+'\s*=\s*'[0-9]+'/gi,
                /'\s*or\s+1\s*=\s*1/gi,
                /'\s*;\s*drop/gi,
                /'\s*;\s*delete/gi,
                /0x[0-9a-f]+/gi
            ],
            type: 'sql-injection',
            severity: 'high'
        },
        xss: {
            patterns: [
                /<script\b/gi,
                /javascript\s*:/gi,
                /onerror\s*=/gi,
                /onload\s*=/gi,
                /onclick\s*=/gi,
                /onfocus\s*=/gi,
                /<iframe\b/gi,
                /<object\b/gi,
                /<embed\b/gi,
                /<applet\b/gi
            ],
            type: 'xss',
            severity: 'high'
        },
        pathTraversal: {
            patterns: [
                /\.\.\//g,
                /\.\.\\/g,
                /\.\.%2f/gi,
                /\.\.%5c/gi,
                /%2e%2e\//gi,
                /%2e%2e%5c/gi
            ],
            type: 'path-traversal',
            severity: 'high'
        },
        commandInjection: {
            patterns: [
                /;\s*rm\s+-rf/gi,
                /\|\s*cat\s+\/etc/gi,
                /;\s*cat\s+\/etc/gi,
                /\|\s*ls/gi,
                /;\s*ls/gi,
                /`[^`]+`/g,
                /\$\([^)]+\)/g,
                /;\s*id/gi,
                /;\s*whoami/gi,
                /\|\s*id/gi,
                /\|\s*whoami/gi
            ],
            type: 'command-injection',
            severity: 'high'
        }
    };
    return (req, res, next) => {
        const threats = [];
        const sources = [
            { name: 'body', data: req.body },
            { name: 'query', data: req.query },
            { name: 'params', data: req.params }
        ];
        function extractStrings(obj) {
            if (obj === null || obj === undefined)
                return [];
            if (typeof obj === 'string')
                return [obj];
            if (Array.isArray(obj)) {
                return obj.flatMap(extractStrings);
            }
            if (typeof obj === 'object') {
                return Object.values(obj).flatMap(extractStrings);
            }
            return [];
        }
        for (const source of sources) {
            if (!source.data)
                continue;
            const strings = extractStrings(source.data);
            const fullText = strings.join(' ');
            for (const [category, config] of Object.entries(threatPatterns)) {
                for (const pattern of config.patterns) {
                    pattern.lastIndex = 0;
                    if (pattern.test(fullText)) {
                        threats.push({
                            type: config.type,
                            severity: config.severity,
                            source: source.name,
                            pattern: pattern.source
                        });
                    }
                }
            }
        }
        if (threats.length > 0) {
            const highSeverityThreats = threats.filter(t => t.severity === 'high');
            req.safetyThreat = {
                detected: true,
                threats,
                primaryType: highSeverityThreats[0]?.type || threats[0].type,
                primaryPattern: highSeverityThreats[0]?.pattern || threats[0].pattern
            };
            try {
                const safetyService = req.app.get('safetyService');
                if (safetyService) {
                    const threatInfo = highSeverityThreats[0] || threats[0];
                    safetyService.logThreat({
                        ip: req.ip || req.connection?.remoteAddress || 'unknown',
                        type: threatInfo.type,
                        pattern: threatInfo.pattern,
                        severity: threatInfo.severity,
                        description: `Detected ${threatInfo.type} attack pattern`,
                        url: req.originalUrl || req.url,
                        method: req.method,
                        timestamp: new Date().toISOString()
                    });
                }
            }
            catch (err) {
                // Silently ignore logging errors
            }
            if (highSeverityThreats.length > 0) {
                return res.status(403).json({
                    success: false,
                    error: {
                        code: 'SECURITY_THREAT_DETECTED',
                        message: '请求因安全威胁检测被拦截',
                        type: highSeverityThreats[0].type
                    }
                });
            }
        }
        next();
    };
}
/**
 * Security headers middleware - adds security-related HTTP response headers
 */
function safetyHeaders() {
    return (req, res, next) => {
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('X-Frame-Options', 'DENY');
        res.set('X-XSS-Protection', '1; mode=block');
        res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.removeHeader('X-Powered-By');
        next();
    };
}
module.exports = {
    rateLimit,
    sanitizeInput,
    detectThreats,
    safetyHeaders
};
//# sourceMappingURL=safety.js.map