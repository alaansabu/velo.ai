/**
 * errorHandler middleware
 *
 * Global Express error handler. Must be registered LAST with `app.use()`.
 * Catches any error thrown or passed via `next(err)` in handlers/services.
 */
function errorHandler(err, req, res, _next) {
  const requestId = req.ctx ? req.ctx.requestId : "unknown";
  console.error(`[ErrorHandler] [${requestId}]`, err.message || err);

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: err.message || "Internal server error",
    requestId,
  });
}

module.exports = errorHandler;
module.exports = errorHandler;
