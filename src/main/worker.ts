import "reflect-metadata";
import { env } from "../config/env.js";
import { logger } from "../shared/utils/logger.js";
import { initSentry } from "../infrastructure/logging/sentry.js";
import { connectMongo } from "../infrastructure/database/database.js";
import { getRedisClient, isRedisReady } from "../infrastructure/cache/redis.js";
import {
  registerShutdownHandler,
  setupGracefulShutdown,
} from "../infrastructure/lifecycle/shutdown.js";
import { jobIngestionService } from "../infrastructure/database/mongoose/services/jobIngestionService.js";
import { emailDigestService } from "../infrastructure/email/emailDigestService.js";
import { Queue, Worker, Job } from "bullmq";
import { applicationRepository } from "../infrastructure/database/mongoose/repositories/MongooseApplicationRepository.js";
import { userRepository } from "../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";
import { assertValidAIConfiguration } from "../infrastructure/ai/config/aiStartupValidation.js";
import { discoveryGraph } from "../infrastructure/ai/graphs/discoveryGraph.js";
import { User } from "../infrastructure/database/mongoose/models/UserModel.js";
import { CacheKeys, del } from "../shared/cache.js";
import { Profile } from "../infrastructure/database/mongoose/models/ProfileModel.js";
import {
  enqueueMatchRefreshForUser,
  markMatchRefresh,
} from "../infrastructure/database/mongoose/services/matchRefreshService.js";
import { MATCH_SCORE_VERSION } from "../domain/services/jobs/matching.js";
import {
  reconcileJobIngestionSchedules,
  writeWorkerHeartbeat,
  type BullQueueLike,
  type RedisLike,
  type ScheduledSource,
} from "../infrastructure/database/mongoose/services/repeatScheduleService.js";
import { refreshReferenceRates } from "../infrastructure/database/mongoose/services/fxRates.js";

interface IngestionJobData {
  sourceKey?: string;
}

interface MatchJobData {
  userId: string;
  profileVersion: number;
  attemptId: string;
  broaden?: boolean;
}

interface ReminderJobData {
  applicationId: string;
  dueAt: string;
}

interface DigestJobData {
  user: { id?: string; email?: string; name?: string };
  matches: Array<Record<string, unknown>>;
}

const activeWorkers: Worker[] = [];
let ingestionQueue: Queue | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

export async function scheduleJobIngestion(queue: Queue, sources: unknown): Promise<unknown> {
  return reconcileJobIngestionSchedules(
    queue as unknown as BullQueueLike,
    sources as ScheduledSource[],
  );
}

async function waitForRedis(
  redis: ReturnType<typeof getRedisClient>,
  timeoutMs = 5000,
): Promise<boolean> {
  if (isRedisReady()) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), timeoutMs);
    const finish = (ready: boolean) => {
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

async function initializeQueues(): Promise<void> {
  const redis = getRedisClient();
  if (!(await waitForRedis(redis))) {
    logger.info("Redis is offline; BullMQ workers and scheduled ingestion remain unavailable");
    return;
  }

  await jobIngestionService.ensureSources();
  await writeWorkerHeartbeat(redis as unknown as RedisLike);
  heartbeatTimer = setInterval(() => {
    writeWorkerHeartbeat(redis as unknown as RedisLike).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ err: msg }, "Worker heartbeat write failed");
    });
  }, 15_000);
  heartbeatTimer.unref?.();
  process.once("SIGINT", () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  });
  process.once("SIGTERM", () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  });
  ingestionQueue = new Queue("job-ingestion", { connection: redis });
  await ingestionQueue.add(
    "refresh-fx-rates",
    {},
    {
      jobId: "fx-rates-daily",
      repeat: { every: 86400000 },
      removeOnComplete: 10,
      removeOnFail: 20,
    },
  );
  await ingestionQueue.add(
    "refresh-fx-rates",
    {},
    {
      jobId: `fx-rates-startup-${new Date().toISOString().slice(0, 10)}`,
      removeOnComplete: 10,
      removeOnFail: 20,
    },
  );
  const sourceSchedules = await scheduleJobIngestion(
    ingestionQueue,
    await jobIngestionService.sourceBudgets(),
  );
  logger.info({ sources: sourceSchedules }, "Scheduled approved job source ingestion");

  // 1. Ingestion Worker
  const ingestionWorker = new Worker(
    "job-ingestion",
    async (job: Job<IngestionJobData>) => {
      if (job.name === "refresh-fx-rates") return refreshReferenceRates();
      logger.info({ jobId: job.id }, "Processing job-ingestion queue item");
      const result: unknown = job.data?.sourceKey
        ? await jobIngestionService.ingestSource(job.data.sourceKey)
        : await jobIngestionService.ingestAll();
      const raw = result as { created?: number; ingested?: number } | null | undefined;
      const added = raw?.created ?? raw?.ingested ?? 0;
      if (added > 0) {
        let refreshed = 0;
        const recentProfiles = Profile.find({
          updatedAt: { $gte: new Date(Date.now() - 30 * 86400000) },
        })
          .select("userId")
          .lean()
          .cursor();
        for await (const profileDoc of recentProfiles) {
          const profileRecord = profileDoc as unknown as { userId: string } | null;
          if (!profileRecord) continue;
          const userDoc = await User.findById(profileRecord.userId)
            .select("profileVersion isDeleted")
            .lean();
          const userRecord = userDoc as { profileVersion?: number; isDeleted?: boolean } | null;
          if (
            userRecord &&
            !userRecord.isDeleted &&
            (await enqueueMatchRefreshForUser(profileRecord.userId, userRecord.profileVersion || 1))
          )
            refreshed += 1;
        }
        logger.info({ refreshed }, "Queued match refreshes after new catalog jobs arrived");
      }
      return { ingested: added, source: job.data?.sourceKey || "all" };
    },
    {
      connection: redis,
      concurrency: 2,
    },
  );

  const matchWorker = new Worker(
    "job-matches",
    async (job: Job<MatchJobData>) => {
      const { userId, profileVersion, attemptId } = job.data;
      const user = await User.findOne({ _id: userId, isDeleted: false }).lean();
      const userRecord = user as { profileVersion?: number } | null;
      if (!userRecord || userRecord.profileVersion !== profileVersion) {
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
        const result: unknown = await (
          discoveryGraph as {
            runDiscovery: (
              user: unknown,
              options: { idempotencyKey?: string; quotaAccepted?: boolean; broaden?: boolean },
            ) => Promise<unknown>;
          }
        ).runDiscovery(user, {
          idempotencyKey: String(job.id),
          quotaAccepted: true,
          broaden: Boolean(job.data.broaden),
        });
        const discoveryResult = result as {
          matches?: unknown[];
          emptyReason?: string;
          broadenActions?: unknown[];
        };
        await markMatchRefresh(attemptId, {
          status: "done",
          completedAt: new Date(),
          resultCount: discoveryResult.matches?.length || 0,
          emptyReason: discoveryResult.emptyReason || "",
          broadenActions: discoveryResult.broadenActions || [],
          nextAllowedAt: new Date(Date.now() + 30_000),
        });
        await del(CacheKeys.response(userId, `matches:${MATCH_SCORE_VERSION}`, profileVersion));
        return { resultCount: discoveryResult.matches?.length || 0 };
      } catch (error: unknown) {
        const err = error as { code?: string };
        await markMatchRefresh(attemptId, {
          status: "failed",
          completedAt: new Date(),
          errorCode: err.code || "MATCH_REFRESH_FAILED",
        });
        throw error;
      }
    },
    { connection: redis, concurrency: 2 },
  );

  // 2. Email Digest Worker
  const digestWorker = new Worker(
    "email-digests",
    async (job: Job<DigestJobData>) => {
      const { user, matches } = job.data;
      logger.info({ userId: user?.id, matchCount: matches?.length }, "Processing email digest");
      return emailDigestService.sendDailyDigest({
        toEmail: user?.email || "",
        candidateName: user?.name || "there",
        matches,
      });
    },
    {
      connection: redis,
      concurrency: 5,
    },
  );

  const reminderWorker = new Worker(
    "application-reminders",
    async (job: Job<ReminderJobData>) => {
      const { applicationId, dueAt } = job.data;
      const app = (await (
        applicationRepository as {
          claimDueReminder: (id: string, date: Date, claimId: string) => Promise<unknown>;
        }
      ).claimDueReminder(applicationId, new Date(dueAt), String(job.id))) as {
        userId?: unknown;
        role?: string;
        company?: string;
        jobUrl?: string;
      } | null;
      if (!app)
        return { skipped: true, reason: "Reminder was changed, disabled, or already processed" };
      const user = (await userRepository.findById(String(app.userId))) as {
        email?: string;
        name?: string;
      } | null;
      if (!user?.email) {
        await applicationRepository.update(applicationId, { reminderStatus: "failed" });
        throw new Error("Reminder owner email is unavailable");
      }
      const result: unknown = await emailDigestService.sendApplicationReminder({
        toEmail: user.email,
        candidateName: user.name || "",
        application: app,
      });
      const deliveryResult = result as { success?: boolean; error?: string; mock?: boolean };
      if (!deliveryResult.success) {
        await applicationRepository.update(applicationId, { reminderStatus: "scheduled" });
        throw new Error(deliveryResult.error || "Reminder delivery failed");
      }
      await applicationRepository.update(applicationId, {
        reminderStatus: deliveryResult.mock ? "mock" : "sent",
        reminderSentAt: new Date(),
      });
      return { sent: true, mock: Boolean(deliveryResult.mock) };
    },
    { connection: redis, concurrency: 10 },
  );

  ingestionWorker.on("completed", (job: Job) => {
    logger.info({ jobId: job.id }, "Job ingestion task completed successfully");
  });

  ingestionWorker.on("failed", (job: Job | undefined, err: Error) => {
    logger.error({ jobId: job?.id, err: err.message }, "Job ingestion task failed");
  });

  activeWorkers.push(ingestionWorker, matchWorker, digestWorker, reminderWorker);
}

export async function startWorker(): Promise<void> {
  assertValidAIConfiguration();
  initSentry();
  logger.info("Initializing JobScout background worker service...");

  await connectMongo();
  getRedisClient();

  await initializeQueues();

  logger.info(`JobScout background worker service initialized [${env.NODE_ENV}]`);

  registerShutdownHandler(async () => {
    jobIngestionService.requestShutdown();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (isRedisReady())
      await getRedisClient()
        .del("jobscout:worker:heartbeat")
        .catch(() => {});
    for (const w of activeWorkers) {
      await w.close();
    }
    if (ingestionQueue) await ingestionQueue.close();
    logger.info("All BullMQ workers shut down gracefully");
  });
  setupGracefulShutdown();
}

if (process.env.NODE_ENV !== "test") {
  startWorker().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.fatal({ err: msg }, "Failed to start background worker");
    process.exit(1);
  });
}
