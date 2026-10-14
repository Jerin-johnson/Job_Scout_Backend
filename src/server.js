import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./shared/utils/logger.js";
import { initSentry } from "./config/sentry.js";
import { connectMongo } from "./config/database.js";
import { getRedisClient } from "./config/redis.js";
import { setupGracefulShutdown } from "./config/shutdown.js";

async function startServer() {
  initSentry();

  // Connect to databases
  await connectMongo();
  getRedisClient();

  const app = createApp();

  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(`JobScout API server running on http://${env.HOST}:${env.PORT} [${env.NODE_ENV}]`);
  });

  setupGracefulShutdown(server);
}

startServer().catch((err) => {
  logger.fatal({ err: err.message }, "Failed to start server");
  process.exit(1);
});
