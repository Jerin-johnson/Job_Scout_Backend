import { env } from "./config/env.js";
import { logger } from "./shared/utils/logger.js";
import { initSentry } from "./config/sentry.js";
import { connectMongo } from "./config/database.js";
import { getRedisClient, isRedisReady } from "./config/redis.js";
import { setupGracefulShutdown } from "./config/shutdown.js";
import { jobIngestionService } from "./services/jobs/jobIngestionService.js";
import { emailDigestService } from "./services/emailDigestService.js";
import { Worker } from "bullmq";
import { applicationRepository } from "./repositories/applicationRepository.js";
import { userRepository } from "./repositories/userRepository.js";
import { assertValidAIConfiguration } from "./config/aiStartupValidation.js";

const activeWorkers = [];

async function initializeQueues() {
  if (!isRedisReady()) {
    logger.info("Redis is offline/mock; BullMQ workers initialized in standby mode");
    return;
  }

  const redis = getRedisClient();

  // 1. Ingestion Worker
  const ingestionWorker = new Worker(
    "job-ingestion",
    async (job) => {
      logger.info({ jobId: job.id }, "Processing job-ingestion queue item");
      const result = await jobIngestionService.ingestAll();
      return { ingested: result.ingested };
    },
    {
      connection: redis,
      concurrency: 2,
    },
  );

  // 2. Email Digest Worker
  const digestWorker = new Worker(
    "email-digests",
    async (job) => {
      const { user, matches } = job.data;
      logger.info({ userId: user?.id, matchCount: matches?.length }, "Processing email digest");
      return emailDigestService.sendDailyDigest(user, matches);
    },
    {
      connection: redis,
      concurrency: 5,
    },
  );

  const reminderWorker = new Worker(
    "application-reminders",
    async (job) => {
      const { applicationId, dueAt } = job.data;
      const app = await applicationRepository.claimDueReminder(
        applicationId,
        new Date(dueAt),
        String(job.id),
      );
      if (!app)
        return { skipped: true, reason: "Reminder was changed, disabled, or already processed" };
      const user = await userRepository.findById(String(app.userId));
      if (!user?.email) {
        await applicationRepository.update(applicationId, { reminderStatus: "failed" });
        throw new Error("Reminder owner email is unavailable");
      }
      const result = await emailDigestService.sendApplicationReminder({
        toEmail: user.email,
        candidateName: user.name,
        application: app,
      });
      if (!result.success) {
        await applicationRepository.update(applicationId, { reminderStatus: "scheduled" });
        throw new Error(result.error || "Reminder delivery failed");
      }
      await applicationRepository.update(applicationId, {
        reminderStatus: result.mock ? "mock" : "sent",
        reminderSentAt: new Date(),
      });
      return { sent: true, mock: Boolean(result.mock) };
    },
    { connection: redis, concurrency: 10 },
  );

  ingestionWorker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "Job ingestion task completed successfully");
  });

  ingestionWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "Job ingestion task failed");
  });

  activeWorkers.push(ingestionWorker, digestWorker, reminderWorker);
}

async function startWorker() {
  assertValidAIConfiguration();
  initSentry();
  logger.info("Initializing JobScout background worker service...");

  await connectMongo();
  getRedisClient();

  await initializeQueues();

  logger.info(`JobScout background worker service initialized [${env.NODE_ENV}]`);

  setupGracefulShutdown(null, async () => {
    for (const w of activeWorkers) {
      await w.close();
    }
    logger.info("All BullMQ workers shut down gracefully");
  });
}

startWorker().catch((err) => {
  logger.fatal({ err: err.message }, "Failed to start background worker");
  process.exit(1);
});
