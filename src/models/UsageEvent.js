import mongoose from "mongoose";

const UsageEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    feature: {
      type: String,
      required: true,
      index: true,
    },
    model: {
      type: String,
      required: true,
    },
    inputTokens: {
      type: Number,
      default: 0,
    },
    outputTokens: {
      type: Number,
      default: 0,
    },
    cacheReadTokens: {
      type: Number,
      default: 0,
    },
    cacheWriteTokens: {
      type: Number,
      default: 0,
    },
    costUsd: {
      type: Number,
      required: true,
      default: 0.0,
    },
    latencyMs: {
      type: Number,
      default: 0,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  },
);

// Compound index for cost calculations and metrics aggregation
UsageEventSchema.index({ userId: 1, createdAt: -1 });
UsageEventSchema.index({ feature: 1, createdAt: -1 });

// TTL index to automatically prune events older than 90 days
UsageEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86400 });

export const UsageEvent =
  mongoose.models.UsageEvent || mongoose.model("UsageEvent", UsageEventSchema);
