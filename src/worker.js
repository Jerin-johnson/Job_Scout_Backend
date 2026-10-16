import { env } from "./config/env.js";
import { logger } from "./shared/utils/logger.js";
import { initSentry } from "./config/sentry.js";
import { connectMongo } from "./config/database.js";
import { getRedisClient, isRedisReady } from "./config/redis.js";
import { setupGracefulShutdown } from "./config/shutdown.js";
import { jobIngestionService } from "./services/jobs/jobIngestionService.js";
import { emailDigestService } from "./services/emailDigestService.js";
import { Queue, Worker } from "bullmq";
import { applicationRepository } from "./repositories/applicationRepository.js";
import { userRepository } from "./repositories/userRepository.js";
import { assertValidAIConfiguration } from "./config/aiStartupValidation.js";
import { discoveryGraph } from "./ai/graphs/discoveryGraph.js";
import { User } from "./models/User.js";
import { CacheKeys, del } from "./shared/cache.js";
import { Profile } from "./models/Profile.js";
import { enqueueMatchRefreshForUser } from "./services/matchRefreshService.js";
import { markMatchRefresh } from "./services/matchRefreshService.js";
import { MATCH_SCORE_VERSION } from "./services/jobs/matching.js";
import { reconcileJobIngestionSchedules, writeWorkerHeartbeat } from "./services/jobs/repeatSchedule.js";
import { refreshReferenceRates } from "./services/jobs/fxRates.js";

const activeWorkers = [];
let ingestionQueue = null;
let heartbeatTimer = null;
export async function scheduleJobIngestion(queue, sources) {
  return reconcileJobIngestionSchedules(queue, sources);
}

async function waitForRedis(redis, timeoutMs = 5000) {
  if (isRedisReady()) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), timeoutMs);
    const finish = (ready) => {
      clearTimeout(timer);
      redis.off("ready", onReady);
      redis.off("end", onEnd);
      resolve(ready);
    };
    const onReady = () => finish(true);
    const onEnd = () => finish(false);
    redis.once("ready", onReady);
    redis.once("end", onEnd);
  });
}

async function initializeQueues() {
  const redis = getRedisClient();
  if (!(await waitForRedis(redis))) {
    logger.info("Redis is offline; BullMQ workers and scheduled ingestion remain unavailable");
    return;
  }

  await jobIngestionService.ensureSources();
  await writeWorkerHeartbeat(redis);
  heartbeatTimer = setInterval(() => {
    writeWorkerHeartbeat(redis).catch((error) => logger.warn({ err: error.message }, "Worker heartbeat write failed"));
  }, 15_000);
  heartbeatTimer.unref?.();
  process.once("SIGINT", () => clearInterval(heartbeatTimer));
  process.once("SIGTERM", () => clearInterval(heartbeatTimer));
  ingestionQueue = new Queue("job-ingestion", { connection: redis });
  await ingestionQueue.add("refresh-fx-rates", {}, { jobId: "fx-rates-daily", repeat: { every: 86400000 }, removeOnComplete: 10, removeOnFail: 20 });
  await ingestionQueue.add("refresh-fx-rates", {}, { jobId: `fx-rates-startup-${new Date().toISOString().slice(0, 10)}`, removeOnComplete: 10, removeOnFail: 20 });
  const sourceSchedules = await scheduleJobIngestion(
    ingestionQueue,
    await jobIngestionService.sourceBudgets(),
  );
  logger.info({ sources: sourceSchedules }, "Scheduled approved job source ingestion");

  // 1. Ingestion Worker
  const ingestionWorker = new Worker(
    "job-ingestion",
    async (job) => {
      if (job.name === "refresh-fx-rates") return refreshReferenceRates();
      logger.info({ jobId: job.id }, "Processing job-ingestion queue item");
      const result = job.data?.sourceKey
        ? await jobIngestionService.ingestSource(job.data.sourceKey)
        : await jobIngestionService.ingestAll();
      const added = result.created ?? result.ingested ?? 0;
      if (added > 0) {
        let refreshed = 0;
        const recentProfiles = Profile.find({
          updatedAt: { $gte: new Date(Date.now() - 30 * 86400000) },
        })
          .select("userId")
          .lean()
          .cursor();
        for await (const profile of recentProfiles) {
          const user = await User.findById(profile.userId)
            .select("profileVersion isDeleted")
            .lean();
          if (
            user &&
            !user.isDeleted &&
            (await enqueueMatchRefreshForUser(profile.userId, user.profileVersion || 1))
          )
            refreshed += 1;
        }
        logger.info({ refreshed }, "Queued match refreshes after new catalog jobs arrived");
      }
      return { ingested: result.created ?? result.ingested, source: job.data?.sourceKey || "all" };
    },
    {
      connection: redis,
      concurrency: 2,
    },
  );

  const matchWorker = new Worker(
    "job-matches",
    async (job) => {
      const { userId, profileVersion, attemptId } = job.data;
      const user = await User.findOne({ _id: userId, isDeleted: false }).lean();
      if (!user || user.profileVersion !== profileVersion) {
        await markMatchRefresh(attemptId, {
          status: "done",
          completedAt: new Date(),
          resultCount: 0,
          nextAllowedAt: new Date(Date.now() + 30_000),
        });
        return { skipped: true, reason: "profile_version_changed" };
      }
      await markMatchRefresh(attemptId, { status: "running", startedAt: new Date() });
      try {
        const result = await discoveryGraph.runDiscovery(user, {
          requestId: job.id,
          quotaAccepted: true,
          broaden: Boolean(job.data.broaden),
        });
        await markMatchRefresh(attemptId, {
          status: "done",
          completedAt: new Date(),
          resultCount: result.matches?.length || 0,
          emptyReason: result.emptyReason || "",
          broadenActions: result.broadenActions || [],
          nextAllowedAt: new Date(Date.now() + 30_000),
        });
        await del(CacheKeys.response(userId, `matches:${MATCH_SCORE_VERSION}`, profileVersion));
        return { resultCount: result.matches?.length || 0 };
      } catch (error) {
        await markMatchRefresh(attemptId, {
          status: "failed",
          completedAt: new Date(),
          errorCode: error.code || "MATCH_REFRESH_FAILED",
        });
        throw error;
      }
    },
    { connection: redis, concurrency: 2 },
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

  activeWorkers.push(ingestionWorker, matchWorker, digestWorker, reminderWorker);
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
    clearInterval(heartbeatTimer);
    if (isRedisReady()) await getRedisClient().del("jobscout:worker:heartbeat").catch(() => {});
    for (const w of activeWorkers) {
      await w.close();
    }
    if (ingestionQueue) await ingestionQueue.close();
    logger.info("All BullMQ workers shut down gracefully");
  });
}

startWorker().catch((err) => {
  logger.fatal({ err: err.message }, "Failed to start background worker");
  process.exit(1);
});
