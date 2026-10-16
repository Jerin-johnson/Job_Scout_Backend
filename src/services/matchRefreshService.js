import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { getRedisClient, isRedisReady } from "../config/redis.js";
import { isMongoReady } from "../config/database.js";
import { MatchRefresh } from "../models/MatchRefresh.js";

let queue;
let queueOverride = null;
function getQueue() {
  if (queueOverride) return queueOverride;
  if (!isRedisReady()) {
    const error = new Error("Match refresh queue is temporarily unavailable");
    error.statusCode = 503;
    error.code = "MATCH_QUEUE_UNAVAILABLE";
    throw error;
  }
  queue ||= new Queue("job-matches", { connection: getRedisClient() });
  return queue;
}

export function configureMatchRefreshQueue(queueLike = null) {
  queueOverride = queueLike;
}

export async function requestMatchRefresh(userId, profileVersion, { broaden = false } = {}) {
  const jobQueue = getQueue();
  const now = new Date();
  const current = await MatchRefresh.findOne({ userId, profileVersion }).lean();
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
  let record;
  try {
    record = await MatchRefresh.findOneAndUpdate(
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
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const coalesced = await MatchRefresh.findOne({ userId, profileVersion }).lean();
    if (coalesced && ["queued", "running"].includes(coalesced.status)) return coalesced;
    throw error;
  }
  if (!record) return (await MatchRefresh.findOne({ userId, profileVersion }).lean()) || null;
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
  return record.toObject();
}

export async function getMatchRefresh(userId, profileVersion) {
  if (!isMongoReady()) return null;
  return MatchRefresh.findOne({ userId, profileVersion }).lean();
}

export async function markMatchRefresh(attemptId, updates) {
  return MatchRefresh.findOneAndUpdate({ attemptId }, { $set: updates }, { new: true }).lean();
}

export async function enqueueMatchRefreshForUser(userId, profileVersion) {
  try {
    return await requestMatchRefresh(userId, profileVersion);
  } catch {
    if (isMongoReady()) {
      const attemptId = randomUUID();
      await MatchRefresh.findOneAndUpdate(
        { userId, profileVersion },
        {
          $set: {
            status: "failed",
            errorCode: "MATCH_QUEUE_UNAVAILABLE",
            completedAt: new Date(),
            attemptId,
          },
          $setOnInsert: { userId, profileVersion },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).catch(() => {});
    }
    return null;
  }
}

export async function closeMatchRefreshQueue() {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
