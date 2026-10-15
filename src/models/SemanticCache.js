import mongoose from "mongoose";

const SemanticCacheSchema = new mongoose.Schema(
  {
    promptHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    queryText: {
      type: String,
      required: true,
    },
    responseText: {
      type: String,
      required: true,
    },
    embedding: {
      type: [Number],
      default: [],
    },
    // Absent on older cache rows; treat these vectors as legacy/unknown.
    embeddingMetadata: {
      provider: { type: String, default: undefined },
      model: { type: String, default: undefined },
      dimension: { type: Number, default: undefined },
    },
    isGeneric: {
      type: Boolean,
      default: true,
    },
    hitCount: {
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

// TTL index to automatically purge entries after 7 days
SemanticCacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 86400 });

export const SemanticCache =
  mongoose.models.SemanticCache || mongoose.model("SemanticCache", SemanticCacheSchema);
