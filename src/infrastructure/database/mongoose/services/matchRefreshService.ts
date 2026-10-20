import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { getRedisClient, isRedisReady } from "../../../cache/redis.js";
import { isMongoReady } from "../../database.js";
import { MatchRefresh } from "../models/MatchRefreshModel.js";
import {
  findAffectedUsersForNewJobs,
  INCREMENTAL_MATCH_BUDGET,
  type JobForDemandIndexLike,
} from "./incrementalMatching.js";

let queue: Queue | null = null;
let queueOverride: Queue | null = null;

interface MatchQueueError extends Error {
  statusCode?: number;
  code?: string;
}

function getQueue(): Queue {
  if (queueOverride) return queueOverride;
  if (!isRedisReady()) {
    const error: MatchQueueError = new Error("Match refresh queue is temporarily unavailable");
    error.statusCode = 503;
    error.code = "MATCH_QUEUE_UNAVAILABLE";
    throw error;
  }
  queue ||= new Queue("job-matches", { connection: getRedisClient() });
  return queue;
}

export function configureMatchRefreshQueue(queueLike: Queue | null = null): void {
  queueOverride = queueLike;
}

export interface MatchRefreshRecordLike {
  userId: string | mongoose.Types.ObjectId;
  profileVersion: number;
  status: string;
  broaden?: boolean;
  requestedAt?: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  resultCount?: number;
  errorCode?: string;
  attemptId?: string;
  nextAllowedAt?: Date | null;
  updatedAt?: Date;
  toObject?: () => Record<string, unknown>;
}

export async function requestMatchRefresh(
  userId: string | mongoose.Types.ObjectId,
  profileVersion: number,
  { broaden = false }: { broaden?: boolean } = {},
): Promise<MatchRefreshRecordLike | null> {
  const jobQueue = getQueue();
  const now = new Date();
  const current = (await MatchRefresh.findOne({
    userId,
    profileVersion,
  }).lean()) as MatchRefreshRecordLike | null;
  if (current && ["queued", "running"].includes(current.status)) return current;
  if (
    !broaden &&
    current?.status === "done" &&
    current.nextAllowedAt &&
    new Date(current.nextAllowedAt) > now
  )
    return current;

  const attemptId = randomUUID();
  const filter = { userId, profileVersion, ...(current ? { updatedAt: current.updatedAt } : {}) };
  let record: { toObject?: () => Record<string, unknown> } | null = null;
  try {
    record = (await MatchRefresh.findOneAndUpdate(
      filter,
      {
        $set: {
          status: "queued",
          broaden,
          requestedAt: now,
          startedAt: null,
          completedAt: null,
          resultCount: 0,
          errorCode: "",
          attemptId,
        },
        $setOnInsert: { userId, profileVersion },
      },
      { new: true, upsert: !current, setDefaultsOnInsert: true },
    )) as unknown as { toObject?: () => Record<string, unknown> } | null;
  } catch (cause) {
    const error = cause as { code?: number };
    if (error?.code !== 11000) throw cause;
    const coalesced = (await MatchRefresh.findOne({
      userId,
      profileVersion,
    }).lean()) as MatchRefreshRecordLike | null;
    if (coalesced && ["queued", "running"].includes(coalesced.status)) return coalesced;
    throw cause;
  }
  if (!record)
    return (
      ((await MatchRefresh.findOne({
        userId,
        profileVersion,
      }).lean()) as MatchRefreshRecordLike | null) || null
    );
  try {
    await jobQueue.add(
      "refresh",
      { userId: String(userId), profileVersion, attemptId, broaden },
      {
        jobId: `match-${userId}-${profileVersion}-${attemptId}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  } catch (error) {
    await markMatchRefresh(attemptId, {
      status: "failed",
      completedAt: new Date(),
      errorCode: "MATCH_QUEUE_UNAVAILABLE",
    });
    throw error;
  }
  return record.toObject
    ? (record.toObject() as unknown as MatchRefreshRecordLike)
    : (record as unknown as MatchRefreshRecordLike);
}

export async function getMatchRefresh(
  userId: string | mongoose.Types.ObjectId,
  profileVersion: number,
): Promise<MatchRefreshRecordLike | null> {
  if (!isMongoReady()) return null;
  return (await MatchRefresh.findOne({
    userId,
    profileVersion,
  }).lean()) as MatchRefreshRecordLike | null;
}

export async function markMatchRefresh(
  attemptId: string,
  updates: Record<string, unknown>,
): Promise<MatchRefreshRecordLike | null> {
  return (await MatchRefresh.findOneAndUpdate(
    { attemptId },
    { $set: updates },
    { new: true },
  ).lean()) as MatchRefreshRecordLike | null;
}

export async function enqueueMatchRefreshForUser(
  userId: string | mongoose.Types.ObjectId,
  profileVersion?: number,
): Promise<MatchRefreshRecordLike | null> {
  const version = typeof profileVersion === "number" ? profileVersion : 1;
  try {
    return await requestMatchRefresh(userId, version);
  } catch {
    if (isMongoReady()) {
      const attemptId = randomUUID();
      await MatchRefresh.findOneAndUpdate(
        { userId, profileVersion: version },
        {
          $set: {
            status: "failed",
            errorCode: "MATCH_QUEUE_UNAVAILABLE",
            completedAt: new Date(),
            attemptId,
          },
          $setOnInsert: { userId, profileVersion: version },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).catch(() => {});
    }
    return null;
  }
}

export interface IncrementalMatchesResult {
  enqueued: number;
  affectedCount: number;
  candidateCount: number;
  budgetMaxUsers: number;
  batchTokens: string[];
}

export async function enqueueIncrementalMatchesForNewJobs(
  newJobs: JobForDemandIndexLike[] = [],
  { maxUsers = INCREMENTAL_MATCH_BUDGET.maxUsersPerRun }: { maxUsers?: number } = {},
): Promise<IncrementalMatchesResult> {
  const { affectedUsers, candidateCount, budgetMaxUsers, batchTokens } =
    await findAffectedUsersForNewJobs(newJobs, { maxUsers });
  let enqueued = 0;
  for (const user of affectedUsers) {
    const result = await enqueueMatchRefreshForUser(user.userId, user.profileVersion);
    if (result) enqueued += 1;
  }
  return {
    enqueued,
    affectedCount: affectedUsers.length,
    candidateCount,
    budgetMaxUsers,
    batchTokens,
  };
}

export async function recordLocalMatchRefreshDone(
  userId: string | mongoose.Types.ObjectId,
  profileVersion: number,
  resultCount: number,
  emptyReason: string = "",
): Promise<MatchRefreshRecordLike | null> {
  const refresh = await MatchRefresh.findOneAndUpdate(
    { userId, profileVersion },
    {
      $set: {
        status: "done",
        resultCount,
        emptyReason,
        completedAt: new Date(),
        nextAllowedAt: new Date(Date.now() + 30_000),
        attemptId: `local-${Date.now()}`,
      },
      $setOnInsert: { userId, profileVersion },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return refresh as MatchRefreshRecordLike | null;
}

export async function closeMatchRefreshQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
