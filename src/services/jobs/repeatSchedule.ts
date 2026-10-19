import { hostname } from "node:os";

export interface ScheduledSource {
  key: string;
  enabled?: boolean;
  approved?: boolean;
  quota?: { intervalMs?: number };
  [key: string]: unknown;
}

export interface BullRepeatableJob {
  name?: string;
  every?: number | string | null;
  key: string;
  [key: string]: unknown;
}

export interface BullQueueLike {
  getRepeatableJobs: (start?: number, end?: number, asc?: boolean) => Promise<BullRepeatableJob[]>;
  removeRepeatableByKey: (key: string) => Promise<unknown>;
  add: (name: string, data: unknown, opts?: Record<string, unknown>) => Promise<unknown>;
}

export interface RedisLike {
  set: (key: string, value: string, ...args: unknown[]) => Promise<unknown>;
  [key: string]: unknown;
}

export async function reconcileJobIngestionSchedules(
  queue: BullQueueLike,
  sources: ScheduledSource[],
): Promise<string[]> {
  const desired = new Map<string, number>();
  for (const source of sources) {
    if (source.enabled && source.approved && source.quota?.intervalMs) {
      desired.set(source.key, source.quota.intervalMs);
    }
  }
  const repeatables = await queue.getRepeatableJobs(0, -1, true);
  for (const repeatable of repeatables) {
    if (!String(repeatable.name || "").startsWith("ingest:")) continue;
    const key = String(repeatable.name).slice("ingest:".length);
    if (!desired.has(key) || repeatable.every !== desired.get(key)) {
      await queue.removeRepeatableByKey(repeatable.key);
    }
  }
  const scheduled: string[] = [];
  for (const [key, intervalMs] of desired) {
    await queue.add(
      `ingest:${key}`,
      { sourceKey: key },
      {
        jobId: `scheduled-${key}`,
        repeat: { every: intervalMs },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    scheduled.push(key);
  }
  return scheduled;
}

export async function writeWorkerHeartbeat(
  redis: RedisLike,
  now: Date = new Date(),
  workerId: string = `${hostname()}:${process.pid}`,
): Promise<void> {
  const payload = JSON.stringify({ workerId, lastSeenAt: now.toISOString() });
  await redis.set("jobscout:worker:heartbeat", payload, "EX", 45);
  await redis.set("jobscout:worker:last-seen", now.toISOString(), "EX", 30 * 86400);
}
