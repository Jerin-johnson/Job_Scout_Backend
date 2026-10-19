import express, { Express, Request, Response, NextFunction, ErrorRequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import { env } from "../config/env.js";
import { httpLogger } from "../shared/utils/logger.js";
import { isTrustedWebOrigin } from "../shared/utils/webOrigin.js";
import { createApiRouter } from "../presentation/http/routes/index.js";
import { healthRouter } from "../routes/health.js";
import { errorHandlerMiddleware } from "../presentation/http/middleware/errorHandlerMiddleware.js";

export function createApp(): Express {
  const app = express();

  // Trust proxy for reverse proxies / load balancers (Vercel/Fly/Railway/AWS)
  app.set("trust proxy", env.TRUST_PROXY === "1" ? 1 : env.TRUST_PROXY);

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: env.NODE_ENV === "production" ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Strict CORS allowlist
  app.use(
    cors({
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (isTrustedWebOrigin(origin, env)) {
          return callback(null, true);
        }
        return callback(new Error("CORS policy violation: Disallowed origin"));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Request-Id",
        "X-Requested-With",
        "Idempotency-Key",
        "Sec-Fetch-Site",
      ],
      exposedHeaders: ["X-Request-Id", "ETag"],
    }),
  );

  // HTTP request logger with redactions
  app.use(httpLogger);

  // Propagate X-Request-Id header on all responses
  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqId = (req as Request & { id?: string }).id || req.headers["x-request-id"];
    if (reqId) {
      res.setHeader("X-Request-Id", reqId as string);
    }
    next();
  });

  // Enable ETag on cacheable responses
  app.set("etag", "strong");

  // Compression
  app.use(compression());

  // Cookie parser
  app.use(cookieParser());

  // Webhooks need raw body for signature verification before JSON parsing
  app.use("/api/v1/billing/razorpay-webhook", express.raw({ type: "application/json" }));

  // Standard JSON and urlencoded parser
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  // Root health endpoints (root, live, ready)
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
    });
  });
  app.use("/health", healthRouter);

  // Mount API v1 router
  app.use("/api/v1", createApiRouter());

  // Fallback 404 handler for unknown routes
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: `Route not found: ${req.method} ${req.originalUrl}`,
        requestId:
          (req as Request & { id?: string }).id ||
          (req.headers["x-request-id"] as string | undefined) ||
          "req_unknown",
      },
    });
  });

  // Central error handler
  app.use(errorHandlerMiddleware as ErrorRequestHandler);

  return app;
}
