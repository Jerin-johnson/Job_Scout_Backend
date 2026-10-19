import { createApp } from "./app.js";
import { env } from "../config/env.js";
import { logger } from "../shared/utils/logger.js";
import { initSentry } from "../config/sentry.js";
import { connectMongo } from "../config/database.js";
import { getRedisClient } from "../config/redis.js";
import { setupGracefulShutdown, registerShutdownHandler } from "../config/shutdown.js";
import { userRepository } from "../repositories/userRepository.js";
import { ROLES } from "../shared/constants/plans.js";
import { interviewRepository } from "../repositories/interviewRepository.js";
import { assertValidAIConfiguration } from "../config/aiStartupValidation.js";

export async function bootstrap(): Promise<void> {
  assertValidAIConfiguration();
  initSentry();

  // Connect to databases
  await connectMongo();
  getRedisClient();

  const interviewExpirySweep = setInterval(async () => {
    try {
      const result = await interviewRepository.expirePastSessions();
      if (result?.modifiedCount) {
        logger.info({ expiredCount: result.modifiedCount }, "Expired timed-out mock interviews");
      }
    } catch (error: unknown) {
      const err = error as { code?: string; name?: string };
      logger.warn({ code: err.code, name: err.name }, "Mock interview expiry sweep failed");
    }
  }, 60_000);
  interviewExpirySweep.unref();
  registerShutdownHandler(() => clearInterval(interviewExpirySweep));

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
    logger.info(
      { port: env.PORT, host: env.HOST, env: env.NODE_ENV },
      `JobScout API server running on http://${env.HOST}:${env.PORT} [${env.NODE_ENV}]`,
    );
  });

  (setupGracefulShutdown as (s?: unknown) => void)(server);
}

if (process.env.NODE_ENV !== "test") {
  bootstrap().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.fatal({ err: message }, "Failed to start server");
    process.exit(1);
  });
}
