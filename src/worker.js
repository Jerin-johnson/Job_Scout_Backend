import { env } from "./config/env.js";
import { logger } from "./shared/utils/logger.js";
import { initSentry } from "./config/sentry.js";
import { connectMongo } from "./config/database.js";
import { getRedisClient } from "./config/redis.js";
import { setupGracefulShutdown } from "./config/shutdown.js";

async function startWorker() {
  initSentry();
  logger.info("Initializing JobScout background worker service...");

  await connectMongo();
  getRedisClient();

  logger.info(`JobScout background worker service initialized [${env.NODE_ENV}]`);

  setupGracefulShutdown();
}

startWorker().catch((err) => {
  logger.fatal({ err: err.message }, "Failed to start background worker");
  process.exit(1);
});
