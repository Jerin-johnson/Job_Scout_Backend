import { Redis } from "ioredis";
import dotenv from "dotenv";

import { logger } from "../shared/utils/logger.js";
import { env } from "./env.js";

let redisClient = null;
let isRedisConnected = false;

dotenv.config();

// export function getRedisClient() {
//   redisClient = new IORedis({
//     host: process.env.REDIS_HOST,
//     port: Number(process.env.REDIS_PORT),
//     username: process.env.REDIS_USERNAME,
//     password: process.env.REDIS_PASSWORD,
//     maxRetriesPerRequest: null,
//   });

//   redisClient.on("connect", () => {
//     console.log("IORedis connected ✅");
//   });

//   redisClient.on("error", (err) => {
//     console.error("IORedis error:", err);
//   });

//   return redisClient;
// }

export function getRedisClient() {
  if (redisClient) return redisClient;

  redisClient = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectTimeout: 5000,
    retryStrategy(times) {
      if (times > 10) {
        logger.warn("Redis retry limit exceeded. Operating in fail-open cache mode.");
        return null;
      }
      return Math.min(times * 100, 3000);
    },
  });

  redisClient.on("connect", () => {
    isRedisConnected = true;
    logger.info("Connected to Redis");
  });

  redisClient.on("ready", () => {
    isRedisConnected = true;
    checkRedisMaxmemoryPolicy(redisClient).catch((err) => {
      if (env.NODE_ENV === "production") logger.error({ err: err.message }, "Unable to verify Redis maxmemory-policy; BullMQ requires noeviction");
      else logger.warn({ err: err.message }, "Unable to verify Redis maxmemory-policy; BullMQ requires noeviction");
    });
  });

  redisClient.on("error", (err) => {
    isRedisConnected = false;
    logger.warn({ err: err.message }, "Redis connection error, fail-open active");
  });

  redisClient.on("close", () => {
    isRedisConnected = false;
  });

  return redisClient;
}

export async function checkRedisMaxmemoryPolicy(client) {
  const result = await client.config("GET", "maxmemory-policy");
  const policy = Array.isArray(result) ? result[1] : result?.["maxmemory-policy"];
  if (policy !== "noeviction") {
    if (env.NODE_ENV === "production") logger.error({ policy: policy || "unknown" }, "Redis maxmemory-policy must be noeviction for BullMQ reliability");
    else logger.warn({ policy: policy || "unknown" }, "Redis maxmemory-policy must be noeviction for BullMQ reliability");
    return { valid: false, policy: policy || null };
  }
  logger.info("Redis maxmemory-policy is noeviction");
  return { valid: true, policy };
}

export function isRedisReady() {
  return isRedisConnected && redisClient && redisClient.status === "ready";
}

export async function disconnectRedis() {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    }
    isRedisConnected = false;
    redisClient = null;
    logger.info("Redis disconnected");
  }
}
