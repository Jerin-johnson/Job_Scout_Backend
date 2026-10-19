import express, { Express, Request, Response, NextFunction, ErrorRequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import { env } from "../config/env.js";
import { httpLogger } from "../shared/utils/logger.js";
import { isTrustedWebOrigin } from "../shared/utils/webOrigin.js";
import { createApiRouter } from "../presentation/http/routes/index.js";
import { errorHandlerMiddleware } from "../presentation/http/middleware/errorHandlerMiddleware.js";

export function createApp(): Express {
  const app = express();

  app.set("trust proxy", env.TRUST_PROXY === "1" ? 1 : env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: env.NODE_ENV === "production" ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

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

  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(httpLogger);

  // Health endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
    });
  });

  // Mount Clean Architecture Presentation Routes
  app.use("/api/v1", createApiRouter());

  // Error handling middleware
  app.use(errorHandlerMiddleware as ErrorRequestHandler);

  return app;
}
