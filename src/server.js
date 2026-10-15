import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./shared/utils/logger.js";
import { initSentry } from "./config/sentry.js";
import { connectMongo } from "./config/database.js";
import { getRedisClient } from "./config/redis.js";
import { setupGracefulShutdown } from "./config/shutdown.js";
import { userRepository } from "./repositories/userRepository.js";
import { ROLES } from "./shared/constants/plans.js";

async function startServer() {
  initSentry();

  // Connect to databases
  await connectMongo();
  getRedisClient();

  if (env.SUPER_ADMIN_EMAIL) {
    const bootstrapUser = await userRepository.findByEmail(env.SUPER_ADMIN_EMAIL);
    if (bootstrapUser && bootstrapUser.role !== ROLES.SUPER_ADMIN) {
      await userRepository.update(String(bootstrapUser._id), { role: ROLES.SUPER_ADMIN });
      logger.warn(
        { email: env.SUPER_ADMIN_EMAIL.toLowerCase() },
        "Bootstrapped configured super administrator",
      );
    } else if (!bootstrapUser) {
      logger.warn(
        { email: env.SUPER_ADMIN_EMAIL.toLowerCase() },
        "SUPER_ADMIN_EMAIL account does not exist yet; create it and restart to bootstrap access",
      );
    }
  }

  const app = createApp();

  const server = app.listen(env.PORT, env.HOST, () => {
    console.log(`JobScout API server running on http://${env.HOST}:${env.PORT} [${env.NODE_ENV}]`);
    logger.info(`JobScout API server running on http://${env.HOST}:${env.PORT} [${env.NODE_ENV}]`);
  });

  setupGracefulShutdown(server);
}

startServer().catch((err) => {
  logger.fatal({ err: err.message }, "Failed to start server");
  process.exit(1);
});
