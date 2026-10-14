import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MemorySaver } from "@langchain/langgraph";
import mongoose from "mongoose";
import { isMongoReady } from "../config/database.js";
import { logger } from "../shared/utils/logger.js";

let mongoCheckpointer = null;
const memoryCheckpointer = new MemorySaver();

/**
 * Get or create LangGraph checkpointer instance
 */
export function getCheckpointer() {
  if (isMongoReady()) {
    try {
      if (!mongoCheckpointer) {
        const client = mongoose.connection.getClient();
        mongoCheckpointer = new MongoDBSaver({ client });
      }
      return mongoCheckpointer;
    } catch (err) {
      logger.warn({ err: err.message }, "Failed to init Mongo checkpointer, using MemorySaver");
      return memoryCheckpointer;
    }
  }

  return memoryCheckpointer;
}
