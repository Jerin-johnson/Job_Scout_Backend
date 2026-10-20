import { Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRedisClient, isRedisReady } from "../../../config/redis.js";

type RedisReplyType = boolean | number | string | (boolean | number | string)[];

function userKey(req: Request): string {
  return String(req.user?._id || (req.user as unknown as { id?: string })?.id || "anonymous");
}

interface InterviewLimiterOptions {
  name: string;
  limit: number;
  windowMs: number;
}

function createInterviewLimiter({ name, limit, windowMs }: InterviewLimiterOptions) {
  const store = isRedisReady()
    ? new RedisStore({
        prefix: `jobscout:ratelimit:interview:${name}:`,
        sendCommand: (...args: string[]) =>
          (getRedisClient().call as (...params: unknown[]) => Promise<RedisReplyType>)(...args),
      })
    : undefined;

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    passOnStoreError: true,
    keyGenerator: userKey,
    store,
    handler(_req: Request, res: Response) {
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
