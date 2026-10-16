import { hostname } from "node:os";

export async function reconcileJobIngestionSchedules(queue, sources) {
  const desired = new Map();
  for (const source of sources) {
    if (source.enabled && source.approved && source.quota?.intervalMs) desired.set(source.key, source.quota.intervalMs);
  }
  const repeatables = await queue.getRepeatableJobs(0, -1, true);
  for (const repeatable of repeatables) {
    if (!String(repeatable.name || "").startsWith("ingest:")) continue;
    const key = String(repeatable.name).slice("ingest:".length);
    if (!desired.has(key) || repeatable.every !== desired.get(key)) await queue.removeRepeatableByKey(repeatable.key);
  }
  const scheduled = [];
  for (const [key, intervalMs] of desired) {
    await queue.add(`ingest:${key}`, { sourceKey: key }, {
      jobId: `scheduled-${key}`, repeat: { every: intervalMs }, removeOnComplete: 100, removeOnFail: 100,
    });
    scheduled.push(key);
  }
  return scheduled;
}

export async function writeWorkerHeartbeat(redis, now = new Date(), workerId = `${hostname()}:${process.pid}`) {
  const payload = JSON.stringify({ workerId, lastSeenAt: now.toISOString() });
  await redis.set("jobscout:worker:heartbeat", payload, "EX", 45);
  await redis.set("jobscout:worker:last-seen", now.toISOString(), "EX", 30 * 86400);
}
