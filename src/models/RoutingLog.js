import mongoose from "mongoose";

const RoutingLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tier: {
      type: Number,
      enum: [0, 1, 2],
      required: true,
      index: true,
    },
    intent: {
      type: String,
      required: true,
      index: true,
    },
    complexity: {
      type: String,
      default: "low",
    },
    confidence: {
      type: Number,
      default: 1.0,
    },
    escalated: {
      type: Boolean,
      default: false,
    },
    cacheHit: {
      type: Boolean,
      default: false,
    },
    latencyMs: {
      type: Number,
      default: 0,
    },
    costUsd: {
      type: Number,
      default: 0.0,
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

// TTL index to automatically prune logs older than 30 days
RoutingLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 86400 });

export const RoutingLog =
  mongoose.models.RoutingLog || mongoose.model("RoutingLog", RoutingLogSchema);
