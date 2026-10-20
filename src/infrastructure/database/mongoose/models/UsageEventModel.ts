import mongoose, { Document, Model, Schema } from "mongoose";

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
    provider: { type: String, default: "unknown", index: true },
    plan: { type: String, default: "free", index: true },
    planVersion: { type: String, default: "unversioned" },
    requestId: { type: String, default: null, index: true },
    attemptId: { type: String, default: null },
    status: { type: String, enum: ["success", "partial", "failed"], default: "success", index: true },
    outcome: { type: String, default: "success" },
    usageIsEstimated: { type: Boolean, default: false },
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
    cachedInputTokens: { type: Number, default: 0 },
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
    pricingVersion: { type: String, default: "unknown" },
    retryCount: { type: Number, min: 0, default: 0 },
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
