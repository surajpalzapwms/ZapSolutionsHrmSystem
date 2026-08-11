// utils/asyncHandler.js
// Wraps an async controller fn so rejected promises are forwarded to
// Express's error handler instead of needing a try/catch in every function.
// This is what makes the controllers below "robust by default" - a thrown
// error anywhere (bad ObjectId cast, DB timeout, etc.) can never crash the
// process or hang the request.

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Small custom error class so controllers can throw with an explicit
 * HTTP status instead of always defaulting to 500.
 * Usage: throw new ApiError(404, "Holiday not found");
 */
export class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isApiError = true;
  }
}

/**
 * Central error handler - mount this LAST in server.js:
 *   app.use(errorHandler);
 * Handles ApiError, Mongoose CastError/ValidationError, and duplicate-key
 * errors consistently so every module returns the same JSON error shape.
 */
export const errorHandler = (err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(`[${req.method} ${req.originalUrl}]`, err);

  if (err.isApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (err.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: `Invalid value for field "${err.path}"`,
    });
  }

  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: Object.values(err.errors).map((e) => e.message),
    });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {}).join(", ");
    return res.status(409).json({
      success: false,
      message: `A record with the same ${field} already exists`,
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error",
    ...(process.env.NODE_ENV === "development" ? { error: err.message } : {}),
  });
};
