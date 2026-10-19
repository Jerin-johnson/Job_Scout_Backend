import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "../../../shared/utils/logger.js";
import { env } from "../../../config/env.js";
import { ApplicationError } from "../../../application/errors/ApplicationError.js";
import { DomainError } from "../../../domain/errors/DomainError.js";

interface CustomErrorLike {
  statusCode?: number;
  code?: string;
  message: string;
}

export function errorHandlerMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const reqWithId = req as Request & { id?: string };
  const requestId =
    reqWithId.id || (req.headers["x-request-id"] as string | undefined) || "req_unknown";

  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request payload",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId,
      },
    });
    return;
  }

  // Handle Typed Application & Domain Errors
  if (err instanceof ApplicationError || err instanceof DomainError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    });
    return;
  }

  // Handle other HTTP errors or unexpected server errors
  const customErr = err && typeof err === "object" ? (err as CustomErrorLike) : null;
  const statusCode = typeof customErr?.statusCode === "number" ? customErr.statusCode : 500;
  const errorCode =
    typeof customErr?.code === "string"
      ? customErr.code
      : statusCode === 500
      ? "INTERNAL_SERVER_ERROR"
      : "BAD_REQUEST";

  if (statusCode >= 500) {
    logger.error({ err, requestId, url: req.url, method: req.method }, "Unhandled server error");
  }

  const message =
    statusCode === 500 && env.NODE_ENV === "production"
      ? "An unexpected error occurred. Please try again later."
      : customErr?.message || "An unexpected error occurred";

  res.status(statusCode).json({
    error: {
      code: errorCode,
      message,
      requestId,
    },
  });
}
