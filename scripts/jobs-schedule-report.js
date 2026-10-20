import { Queue } from "bullmq";
import { connectMongo, disconnectMongo } from "../src/infrastructure/database/database.js";
import { getRedisClient, disconnectRedis } from "../src/infrastructure/cache/redis.js";
import { JobSource } from "../src/infrastructure/database/mongoose/models/JobSourceModel.js";
import { buildJobScheduleReport } from "../src/infrastructure/database/mongoose/services/scheduleReportService.js";

if (process.env.NODE_ENV === "production") {
  console.error("Schedule report is a development command and is disabled in production.");
  process.exit(1);
}

let queue;
try {
  await connectMongo();
  const sources = await JobSource.find({})
    .select("key enabled approved quota.intervalMs lastRunAt")
    .lean();
  const redis = getRedisClient();
  await redis.ping();
  queue = new Queue("job-ingestion", { connection: redis });
  const repeatableJobs = await queue.getRepeatableJobs(0, -1, true);
  const [heartbeat, lastSeenAt] = await Promise.all([
    redis.get("jobscout:worker:heartbeat"),
    redis.get("jobscout:worker:last-seen"),
  ]);
  const online = Boolean(heartbeat);
  const worker = {
    status: online ? "online" : "offline",
    online,
    lastSeenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : null,
  };
  const report = buildJobScheduleReport(sources, repeatableJobs, Date.now(), worker);
  console.log(
    JSON.stringify({ checkedAt: new Date().toISOString(), worker, sources: report }, null, 2),
  );
  if (
    report.some(
      (source) =>
        source.registrationStatus === "not_registered" ||
        source.registrationStatus === "interval_mismatch",
    )
  ) {
    process.exitCode = 1;
  }
} catch {
  console.error(
    "Could not read the job source schedules. Check local MongoDB and Redis availability.",
  );
  process.exitCode = 1;
} finally {
  await queue?.close().catch(() => {});
  await disconnectRedis().catch(() => {});
  await disconnectMongo().catch(() => {});
}
