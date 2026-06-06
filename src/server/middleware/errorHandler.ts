const logger = require('../utils/logger');

/**
 * Custom application error class
 */
class AppError extends Error {
  code: string;
  statusCode: number;
  details: any;

  constructor(code: string, message: string, statusCode = 400, details: any = null) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Global error handler middleware
 */
function errorHandler(err: any, req: any, res: any, _next: any): void {
  // If it's our custom AppError
  if (err instanceof AppError) {
    logger.warn(`AppError: ${err.code} - ${err.message}`, { path: req.path });
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details || undefined
      }
    });
    return;
  }

  // Log unexpected errors
  logger.error('Unexpected error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  // Generic 500 error - don't leak internal details to client
  logger.error('Unhandled error:', { message: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: '服务器内部错误，请稍后重试'
    }
  });
}

/**
 * 404 handler for unknown routes
 */
function notFoundHandler(req: any, res: any): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`
    }
  });
}

module.exports = { AppError, errorHandler, notFoundHandler };
