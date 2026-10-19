import { Queue } from "bullmq";
import { getRedisClient, isRedisReady } from "../config/redis.js";

let reminderQueue: Queue | undefined;
let queueFactoryOverride: (() => Queue) | null = null;

interface ReminderHttpError extends Error {
  code?: string;
  statusCode?: number;
}

function queue(): Queue {
  if (queueFactoryOverride) return queueFactoryOverride();
  if (!isRedisReady()) {
    const error: ReminderHttpError = new Error("Reminder scheduling requires an available Redis connection");
    error.code = "REMINDER_QUEUE_UNAVAILABLE";
    error.statusCode = 503;
    throw error;
  }
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
export function setApplicationReminderQueueFactoryForTests(factory: (() => Queue) | null): void {
  queueFactoryOverride = factory;
  reminderQueue = undefined;
}

export interface ApplicationReminderLike {
  _id?: unknown;
  id?: unknown;
  reminderEnabled?: boolean | null;
  nextFollowUpAt?: string | Date | null;
}

export async function scheduleApplicationReminder(application?: ApplicationReminderLike | null): Promise<void> {
  if (!application || !application.reminderEnabled || !application.nextFollowUpAt) return;
  const dueAt = new Date(application.nextFollowUpAt);
  if (Number.isNaN(dueAt.getTime())) {
    const error: ReminderHttpError = new Error("Invalid reminder date");
    error.code = "INVALID_REMINDER_DATE";
    error.statusCode = 400;
    throw error;
  }
  if (dueAt <= new Date()) {
    const error: ReminderHttpError = new Error("Choose a future date for the reminder");
    error.code = "INVALID_REMINDER_DATE";
    error.statusCode = 400;
    throw error;
  }
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

export async function cancelApplicationReminder(application?: ApplicationReminderLike | null): Promise<void> {
  if (!application?.nextFollowUpAt || (!queueFactoryOverride && !isRedisReady())) return;
  const id = String(application._id || application.id);
  const job = await queue().getJob(
    `follow-up-${id}-${new Date(application.nextFollowUpAt).getTime()}`,
  );
  if (job) await job.remove();
}
