const AuditService = require('../services/AuditService');

/**
 * Audit middleware - automatically records all POST/PUT/DELETE requests
 */
function auditMiddleware(req, res, next) {
  // Only audit mutating methods
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) {
    return next();
  }

  // Extract resource info from URL path
  // e.g., /api/workflows/123 -> targetType=workflow, targetId=123
  const pathParts = req.path.split('/').filter(Boolean);
  // pathParts[0] = 'api', pathParts[1] = resource name, pathParts[2] = id
  const resourceType = pathParts[1] || 'unknown';
  const resourceId = pathParts[2] || null;

  // Map HTTP method to action
  const actionMap = {
    'POST': 'CREATE',
    'PUT': 'UPDATE',
    'DELETE': 'DELETE'
  };

  // Detect special actions from path
  let action = actionMap[req.method];
  if (req.path.includes('/execute')) action = 'EXECUTE';
  if (req.path.includes('/stop')) action = 'STOP';
  if (req.path.includes('/pause')) action = 'PAUSE';
  if (req.path.includes('/resume')) action = 'RESUME';
  if (req.path.includes('/approve')) action = 'APPROVE';
  if (req.path.includes('/folder')) action = 'SET_WORKSPACE';
  if (req.path.includes('/replay')) action = 'REPLAY';

  const detail = `${req.method} ${req.originalUrl}`;
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';

  // Log after response is sent so it doesn't block
  const originalEnd = res.end;
  res.end = function (...args) {
    try {
      AuditService.log(action, resourceType, resourceId, detail, ip);
    } catch (err) {
      // Silently ignore audit errors to not affect response
    }
    originalEnd.apply(this, args);
  };

  next();
}

module.exports = auditMiddleware;
