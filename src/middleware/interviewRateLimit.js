import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRedisClient } from "../config/redis.js";

function userKey(req) {
  return String(req.user?._id || req.user?.id || "anonymous");
}

function createInterviewLimiter({ name, limit, windowMs }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    passOnStoreError: true,
    keyGenerator: userKey,
    store: new RedisStore({
      prefix: `jobscout:ratelimit:interview:${name}:`,
      sendCommand: (...args) => getRedisClient().call(...args),
    }),
    handler(_req, res) {
      return res.status(429).json({
        error: {
          code: "INTERVIEW_RATE_LIMITED",
          message: "Too many interview requests. Please wait a moment and try again.",
        },
      });
    },
  });
}

export const answerRateLimit = createInterviewLimiter({
  name: "answers",
  limit: 30,
  windowMs: 10 * 60 * 1000,
});

export const completeRateLimit = createInterviewLimiter({
  name: "complete",
  limit: 6,
  windowMs: 10 * 60 * 1000,
});
