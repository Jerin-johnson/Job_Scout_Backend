import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRedisClient, isRedisReady } from "../config/redis.js";
import { logger } from "../shared/utils/logger.js";

function createStore(prefix) {
  if (isRedisReady()) {
    try {
      const client = getRedisClient();
      return new RedisStore({
        sendCommand: (...args) => client.call(...args),
        prefix: `rl:${prefix}:`,
      });
    } catch (err) {
      logger.warn({ err: err.message }, `Failed to init Redis store for ${prefix}, using memory`);
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
  keyGenerator: (req) => {
    return req.user ? `user:${req.user._id || req.user.id}` : `ip:${req.ip}`;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please slow down.",
        requestId: req.id || req.headers["x-request-id"] || "req_unknown",
      },
    });
  },
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
  keyGenerator: (req) => `auth:${req.ip}`,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: "AUTH_RATE_LIMIT_EXCEEDED",
        message: "Too many authentication attempts. Please try again later.",
        requestId: req.id || req.headers["x-request-id"] || "req_unknown",
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
  keyGenerator: (req) => {
    return req.user ? `heavy:${req.user._id || req.user.id}` : `heavy:ip:${req.ip}`;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: "HEAVY_ACTION_RATE_LIMITED",
        message: "Heavy AI task rate limit reached. Please wait a moment before trying again.",
        requestId: req.id || req.headers["x-request-id"] || "req_unknown",
      },
    });
  },
});
