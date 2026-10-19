import { Router, Request, Response } from "express";
import { isMongoReady } from "../config/database.js";
import { isRedisReady } from "../config/redis.js";

export const healthRouter = Router();

// Liveness check: indicates process is responsive
healthRouter.get("/live", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Readiness check: verifies Mongo and Redis connectivity
healthRouter.get("/ready", (_req: Request, res: Response) => {
  const mongo = isMongoReady();
  const redis = isRedisReady();

  // If in test/dev with fallback, report status transparently
  const isReady = mongo && redis;
  const statusCode = isReady ? 200 : 503;

  res.status(statusCode).json({
    status: isReady ? "ready" : "degraded",
    dependencies: {
      mongodb: mongo ? "connected" : "disconnected",
      redis: redis ? "connected" : "disconnected",
    },
    timestamp: new Date().toISOString(),
  });
});
