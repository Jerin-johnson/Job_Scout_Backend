import { Queue } from "bullmq";
import { connectMongo, disconnectMongo } from "../src/config/database.js";
import { getRedisClient, disconnectRedis } from "../src/config/redis.js";
import { JobSource } from "../src/models/JobSource.js";
import { buildJobScheduleReport } from "../src/services/jobs/scheduleReport.js";

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
  const report = buildJobScheduleReport(sources, repeatableJobs);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), sources: report }, null, 2));
  if (report.some((source) => source.registrationStatus === "not_registered" || source.registrationStatus === "interval_mismatch")) {
    process.exitCode = 1;
  }
} catch {
  console.error("Could not read the job source schedules. Check local MongoDB and Redis availability.");
  process.exitCode = 1;
} finally {
  await queue?.close().catch(() => {});
  await disconnectRedis().catch(() => {});
  await disconnectMongo().catch(() => {});
}
