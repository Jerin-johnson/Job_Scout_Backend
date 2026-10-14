import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { httpLogger } from "./shared/utils/logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { profileRouter } from "./routes/profile.js";

export function createApp() {
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
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, smoke script)
        if (!origin || origin === env.WEB_ORIGIN) {
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
  app.use((req, res, next) => {
    const reqId = req.id || req.headers["x-request-id"];
    if (reqId) {
      res.setHeader("X-Request-Id", reqId);
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
  app.use("/api/v1/billing/stripe-webhook", express.raw({ type: "application/json" }));
  app.use("/api/v1/billing/razorpay-webhook", express.raw({ type: "application/json" }));

  // Standard JSON and urlencoded parser
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  // Root health endpoints
  app.use("/health", healthRouter);

  // Authentication API routes
  app.use("/api/v1/auth", authRouter);

  // Candidate Profile & Resume routes
  app.use("/api/v1/profile", profileRouter);

  // Fallback 404 handler for unknown routes
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: `Route not found: ${req.method} ${req.originalUrl}`,
        requestId: req.id || req.headers["x-request-id"] || "req_unknown",
      },
    });
  });

  // Central error handler
  app.use(errorHandler);

  return app;
}
