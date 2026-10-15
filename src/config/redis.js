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
