import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "../shared/utils/logger.js";

let isConnected = false;

export async function connectMongo() {
  if (isConnected) return mongoose.connection;

  // Auto-index disabled in production for performance & deterministic migrations
  mongoose.set("autoIndex", env.NODE_ENV !== "production");

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
  } catch (error) {
    logger.warn(
      { err: error.message },
      "MongoDB connection failed; running in degraded/resilient mode",
    );
    return null;
  }
}

export function isMongoReady() {
  return mongoose.connection.readyState === 1;
}

export async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    logger.info("MongoDB disconnected");
  }
}
