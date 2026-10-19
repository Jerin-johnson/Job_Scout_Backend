import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MemorySaver } from "@langchain/langgraph";
import mongoose from "mongoose";
import { isMongoReady } from "../config/database.js";
import { logger } from "../shared/utils/logger.js";

let mongoCheckpointer: MongoDBSaver | null = null;
const memoryCheckpointer = new MemorySaver();

export function toNamespacedThreadId(userId: string | unknown, threadId?: string | null): string {
  const uid = String(userId || "").trim();
  const tid = String(threadId || "default").trim();
  if (!uid) throw new Error("userId is required to namespace threadId");
  return tid.startsWith(`${uid}:`) ? tid : `${uid}:${tid}`;
}

/**
 * Get or create LangGraph checkpointer instance
 */
export function getCheckpointer(): MongoDBSaver | MemorySaver {
  if (isMongoReady()) {
    try {
      if (!mongoCheckpointer) {
        const client = mongoose.connection.getClient() as unknown as ConstructorParameters<typeof MongoDBSaver>[0]["client"];
        mongoCheckpointer = new MongoDBSaver({ client });
      }
      return mongoCheckpointer;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "Failed to init Mongo checkpointer, using MemorySaver");
      return memoryCheckpointer;
    }
  }

  return memoryCheckpointer;
}

/**
 * Purge LangGraph checkpoints for a specific user thread or all threads of a user
 */
export async function purgeUserCheckpoints(userId: string | unknown, threadId: string | null = null): Promise<number> {
  const uid = String(userId || "").trim();
  if (!uid) return 0;
  const prefix = threadId ? toNamespacedThreadId(uid, threadId) : `${uid}:`;

  // Clean in-memory saver storage if present
  try {
    const storageObj = (memoryCheckpointer as unknown as { storage?: Record<string, unknown> }).storage;
    if (storageObj) {
      for (const key of Object.keys(storageObj)) {
        if (threadId ? key === prefix : key.startsWith(prefix)) {
          delete storageObj[key];
        }
      }
    }
  } catch {
    /* ignore in-memory cleanup errors */
  }

  if (!isMongoReady()) return 0;
  try {
    const db = mongoose.connection.db;
    if (!db) return 0;
    const filter = threadId
      ? { thread_id: prefix }
      : { thread_id: { $regex: `^${uid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:` } };
    const [cpResult, writesResult] = await Promise.all([
      db
        .collection("checkpoints")
        .deleteMany(filter)
        .catch(() => ({ deletedCount: 0 })),
      db
        .collection("checkpoint_writes")
        .deleteMany(filter)
        .catch(() => ({ deletedCount: 0 })),
    ]);
    return (cpResult?.deletedCount || 0) + (writesResult?.deletedCount || 0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message }, "Failed to purge MongoDB checkpoints");
    return 0;
  }
}
