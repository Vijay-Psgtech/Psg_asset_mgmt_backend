/* eslint-disable no-unused-vars */
function notFoundHandler(req, res, next) {
  res.status(404).json({ error: 'NotFound', message: `No route for ${req.method} ${req.originalUrl}` });
}

function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl} ->`, err);
  }

  res.status(status).json({
    error: err.name || 'InternalError',
    message: status < 500 ? err.message : 'Something went wrong',
    ...(err.details ? { details: err.details } : {}),
  });
}

module.exports = { notFoundHandler, errorHandler };
