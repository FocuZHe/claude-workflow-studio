const { AppError } = require('./errorHandler');

/**
 * Validate required fields exist in request body
 */
function requireFields(fields) {
  return (req, res, next) => {
    const missing = [];
    for (const field of fields) {
      if (req.body[field] === undefined || req.body[field] === null || req.body[field] === '') {
        missing.push(field);
      }
    }
    if (missing.length > 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Missing required fields: ${missing.join(', ')}`,
        400,
        missing.map(f => ({ field: f, message: `${f} is required` }))
      );
    }
    next();
  };
}

/**
 * Validate string length
 */
function validateString(field, min, max) {
  return (req, res, next) => {
    const value = req.body[field];
    if (value !== undefined && value !== null) {
      if (typeof value !== 'string') {
        throw new AppError('VALIDATION_ERROR', `${field} must be a string`, 400, [
          { field, message: `${field} must be a string` }
        ]);
      }
      // Trim first, then check length on the trimmed value
      const trimmed = value.trim();
      req.body[field] = trimmed;
      if (min !== undefined && trimmed.length < min) {
        throw new AppError('VALIDATION_ERROR', `${field} must be at least ${min} characters`, 400, [
          { field, message: `${field} must be at least ${min} characters` }
        ]);
      }
      if (max !== undefined && trimmed.length > max) {
        throw new AppError('VALIDATION_ERROR', `${field} must be at most ${max} characters`, 400, [
          { field, message: `${field} must be at most ${max} characters` }
        ]);
      }
    }
    next();
  };
}

/**
 * Validate enum field
 */
function validateEnum(field, allowedValues) {
  return (req, res, next) => {
    const value = req.body[field];
    if (value !== undefined && value !== null) {
      if (!allowedValues.includes(value)) {
        throw new AppError('VALIDATION_ERROR', `${field} must be one of: ${allowedValues.join(', ')}`, 400, [
          { field, message: `${field} must be one of: ${allowedValues.join(', ')}` }
        ]);
      }
    }
    next();
  };
}

/**
 * Validate numeric range
 */
function validateNumber(field, min, max) {
  return (req, res, next) => {
    const value = req.body[field];
    if (value !== undefined && value !== null) {
      if (typeof value !== 'number' || isNaN(value)) {
        throw new AppError('VALIDATION_ERROR', `${field} must be a number`, 400, [
          { field, message: `${field} must be a number` }
        ]);
      }
      if (min !== undefined && value < min) {
        throw new AppError('VALIDATION_ERROR', `${field} must be at least ${min}`, 400, [
          { field, message: `${field} must be at least ${min}` }
        ]);
      }
      if (max !== undefined && value > max) {
        throw new AppError('VALIDATION_ERROR', `${field} must be at most ${max}`, 400, [
          { field, message: `${field} must be at most ${max}` }
        ]);
      }
    }
    next();
  };
}

/**
 * Validate pagination query params
 */
function validatePagination(req, res, next) {
  if (req.query.page !== undefined) {
    const page = parseInt(req.query.page, 10);
    if (isNaN(page) || page < 1) {
      throw new AppError('VALIDATION_ERROR', 'page must be a positive integer', 400, [
        { field: 'page', message: 'page must be a positive integer' }
      ]);
    }
    req.query.page = page;
  } else {
    req.query.page = 1;
  }

  if (req.query.limit !== undefined) {
    const limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit < 1 || limit > 100) {
      throw new AppError('VALIDATION_ERROR', 'limit must be between 1 and 100', 400, [
        { field: 'limit', message: 'limit must be between 1 and 100' }
      ]);
    }
    req.query.limit = limit;
  } else {
    req.query.limit = 20;
  }

  next();
}

/**
 * Apply multiple validation middlewares
 */
function validate(...middlewares) {
  return (req, res, next) => {
    let idx = 0;
    function runNext(err) {
      if (err) return next(err);
      if (idx >= middlewares.length) return next();
      const mw = middlewares[idx++];
      try {
        mw(req, res, runNext);
      } catch (e) {
        next(e);
      }
    }
    runNext();
  };
}

module.exports = {
  requireFields,
  validateString,
  validateEnum,
  validateNumber,
  validatePagination,
  validate
};
