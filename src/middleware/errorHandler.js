import { ZodError } from "zod";
import * as Sentry from "@sentry/node";
import { logger } from "../shared/utils/logger.js";
import { env } from "../config/env.js";

export function errorHandler(err, req, res, _next) {
  const requestId = req.id || req.headers["x-request-id"] || "req_unknown";

  // Capture unexpected 5xx errors to Sentry
  if (!err.statusCode || err.statusCode >= 500) {
    if (env.SENTRY_DSN) {
      Sentry.captureException(err, { extra: { requestId } });
    }
    logger.error({ err, requestId, url: req.url, method: req.method }, "Unhandled server error");
  }

  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request payload",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId,
      },
    });
  }

  // Handle known HTTP errors
  const statusCode = err.statusCode || 500;
  const errorCode = err.code || (statusCode === 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST");
  const message =
    statusCode === 500 && env.NODE_ENV === "production"
      ? "An unexpected error occurred. Please try again later."
      : err.message || "An unexpected error occurred";

  return res.status(statusCode).json({
    error: {
      code: errorCode,
      message,
      requestId,
    },
  });
}
