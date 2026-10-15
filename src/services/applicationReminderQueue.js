import { Queue } from "bullmq";
import { getRedisClient, isRedisReady } from "../config/redis.js";

let reminderQueue;
let queueFactoryOverride = null;

function queue() {
  if (queueFactoryOverride) return queueFactoryOverride();
  if (!isRedisReady())
    throw Object.assign(new Error("Reminder scheduling requires an available Redis connection"), {
      code: "REMINDER_QUEUE_UNAVAILABLE",
      statusCode: 503,
    });
  reminderQueue ||= new Queue("application-reminders", {
    connection: getRedisClient(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
  return reminderQueue;
}

// Allows integration tests to verify reminder lifecycle behavior without Redis.
export function setApplicationReminderQueueFactoryForTests(factory) {
  queueFactoryOverride = factory;
  reminderQueue = undefined;
}

export async function scheduleApplicationReminder(application) {
  if (!application.reminderEnabled || !application.nextFollowUpAt) return;
  const dueAt = new Date(application.nextFollowUpAt);
  if (Number.isNaN(dueAt.getTime()))
    throw Object.assign(new Error("Invalid reminder date"), {
      code: "INVALID_REMINDER_DATE",
      statusCode: 400,
    });
  if (dueAt <= new Date())
    throw Object.assign(new Error("Choose a future date for the reminder"), {
      code: "INVALID_REMINDER_DATE",
      statusCode: 400,
    });
  const id = String(application._id || application.id);
  await queue().add(
    "follow-up",
    { applicationId: id, dueAt: dueAt.toISOString() },
    {
      jobId: `follow-up-${id}-${dueAt.getTime()}`,
      delay: Math.max(0, dueAt.getTime() - Date.now()),
    },
  );
}

export async function cancelApplicationReminder(application) {
  if (!application?.nextFollowUpAt || (!queueFactoryOverride && !isRedisReady())) return;
  const id = String(application._id || application.id);
  const job = await queue().getJob(
    `follow-up-${id}-${new Date(application.nextFollowUpAt).getTime()}`,
  );
  if (job) await job.remove();
}
