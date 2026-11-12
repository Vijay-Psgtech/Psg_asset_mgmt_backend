/* eslint-disable no-unused-vars */
const logger = require('../utils/logger');

function notFoundHandler(req, res, next) {
  res.status(404).json({ error: 'NotFound', message: `No route for ${req.method} ${req.originalUrl}` });
}

function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  if (status >= 500) {
    logger.error('http_request_failed', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: status,
      errorName: err.name || 'Error',
      errorCode: err.code,
      errorMessage: typeof err.message === 'string' ? err.message.slice(0, 1000) : 'Unknown error',
      ...(err.diagnosticContext ? { diagnosticContext: err.diagnosticContext } : {}),
      ...(process.env.NODE_ENV !== 'production' && err.stack ? { stack: err.stack } : {}),
    });
  } else if (status === 403) {
    logger.warn('http_request_forbidden', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      userRole: req.user?.role || 'anonymous',
      hasInstitution: Boolean(req.user?.institution),
      message: err.message,
    });
  }

  res.status(status).json({
    error: err.name || 'InternalError',
    message: status < 500 || err.expose ? err.message : 'Something went wrong',
    ...(err.details ? { details: err.details } : {}),
  });[
  {
    "name": "ThinkPad X1 Carbon",
    "category": "Laptop",
    "brand": "Lenovo",
    "model": "X1 Carbon",
    "status": "available",
    "serialNumber": "SERIAL-001"
  }
]
}

module.exports = { notFoundHandler, errorHandler };
