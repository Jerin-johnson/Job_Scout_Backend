import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import * as Sentry from "@sentry/node";
import { logger } from "../shared/utils/logger.js";
import { env } from "../config/env.js";

interface CustomHttpError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(
  err: CustomHttpError,
  req: Request,
  res: Response,
  _next: NextFunction,
): Response | void {
  const requestId = req.id || (req.headers["x-request-id"] as string) || "req_unknown";
  const isInterviewRequest = req.originalUrl?.startsWith("/api/v1/interview/sessions");

  // Capture unexpected 5xx errors to Sentry
  if (!err.statusCode || err.statusCode >= 500) {
    if (env.SENTRY_DSN) {
      if (isInterviewRequest)
        Sentry.captureMessage("Interview request failed", { extra: { requestId, code: err.code } });
      else Sentry.captureException(err, { extra: { requestId } });
    }
    if (isInterviewRequest)
      logger.error(
        { code: err.code, statusCode: err.statusCode, requestId, url: req.url, method: req.method },
        "Interview request failed",
      );
    else
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
