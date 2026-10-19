import { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRedisClient, isRedisReady } from "../config/redis.js";
import { logger } from "../shared/utils/logger.js";

type RedisReplyType = boolean | number | string | (boolean | number | string)[];

function createStore(prefix: string) {
  if (isRedisReady()) {
    try {
      const client = getRedisClient();
      return new RedisStore({
        sendCommand: (...args: string[]) =>
          (client.call as (...params: unknown[]) => Promise<RedisReplyType>)(...args),
        prefix: `rl:${prefix}:`,
      });
    } catch (err: unknown) {
      const error = err as Error;
      logger.warn({ err: error.message }, `Failed to init Redis store for ${prefix}, using memory`);
    }
  }
  return undefined; // in-memory fallback
}

/**
 * General API Rate Limiter: 100 requests per 1 minute per IP/User
 * Fails OPEN if Redis is down for cheap reads.
 */
export const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore("gen"),
  keyGenerator: (req: Request) => {
    return req.user ? `user:${req.user._id || (req.user as unknown as { id?: string }).id}` : `ip:${req.ip}`;
  },
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please slow down.",
        requestId: req.id || (req.headers["x-request-id"] as string) || "req_unknown",
      },
    });
  },
});

export const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore("feedback"),
  keyGenerator: (req: Request) => `feedback:user:${req.user?._id || (req.user as unknown as { id?: string })?.id || req.ip}`,
  handler: (req: Request, res: Response) =>
    res.status(429).json({
      error: {
        code: "FEEDBACK_RATE_LIMITED",
        message: "You have reached the feedback limit. Please try again later.",
        requestId: req.id || "req_unknown",
      },
    }),
});

/**
 * Strict Auth Limiter: 10 attempts per 15 minutes per IP (login, register, forgot password)
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore("auth"),
  keyGenerator: (req: Request) => `auth:${req.ip}`,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      error: {
        code: "AUTH_RATE_LIMIT_EXCEEDED",
        message: "Too many authentication attempts. Please try again later.",
        requestId: req.id || (req.headers["x-request-id"] as string) || "req_unknown",
      },
    });
  },
});

/**
 * Heavy AI Action Limiter: 10 requests per minute per User
 * Fails CLOSED for heavy actions when Redis is down.
 */
export const heavyAiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore("heavy"),
  keyGenerator: (req: Request) => {
    return req.user ? `heavy:${req.user._id || (req.user as unknown as { id?: string }).id}` : `heavy:ip:${req.ip}`;
  },
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      error: {
        code: "HEAVY_ACTION_RATE_LIMITED",
        message: "Heavy AI task rate limit reached. Please wait a moment before trying again.",
        requestId: req.id || (req.headers["x-request-id"] as string) || "req_unknown",
      },
    });
  },
});
