import mongoose, { Connection } from "mongoose";
import { env } from "./env.js";
import { logger } from "../shared/utils/logger.js";

let isConnected = false;

export async function connectMongo({
  autoIndex = env.NODE_ENV !== "production",
}: { autoIndex?: boolean } = {}): Promise<Connection | null> {
  if (isConnected) return mongoose.connection;

  mongoose.set("autoIndex", autoIndex);

  try {
    const conn = await mongoose.connect(env.MONGODB_URI, {
      maxPoolSize: 50,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    isConnected = true;
    logger.info("Connected to MongoDB successfully");
    return conn.connection;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      { err: message },
      "MongoDB connection failed; running in degraded/resilient mode",
    );
    return null;
  }
}

export function isMongoReady(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function disconnectMongo(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    logger.info("MongoDB disconnected");
  }
}
