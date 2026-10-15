import mongoose from "mongoose";

const JobSchema = new mongoose.Schema(
  {
    contentHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      index: true,
    },
    company: {
      type: String,
      required: true,
      index: true,
    },
    companySlug: {
      type: String,
      index: true,
    },
    location: {
      type: String,
      default: "Remote",
      index: true,
    },
    remoteType: {
      type: String,
      enum: ["remote", "hybrid", "onsite"],
      default: "remote",
      index: true,
    },
    salaryRange: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
      currency: { type: String, default: "USD" },
    },
    requirements: [{ type: String }],
    tags: [{ type: String }],
    rawDescription: {
      type: String,
      required: true,
    },
    sourceBoard: {
      type: String,
      required: true,
      index: true,
    },
    sourceUrl: {
      type: String,
      default: "",
    },
    embedding: {
      type: [Number],
      default: [],
    },
    // Missing metadata on pre-existing vectors means legacy/unknown; never infer it.
    embeddingMetadata: {
      provider: { type: String, default: undefined },
      model: { type: String, default: undefined },
      dimension: { type: Number, default: undefined },
    },
    postedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 60 * 86400 * 1000), // 60 days TTL
    },
  },
  {
    timestamps: true,
  },
);

// Compound indexes for discovery and filtering queries
JobSchema.index({ remoteType: 1, postedAt: -1 });
JobSchema.index({ "salaryRange.min": 1, postedAt: -1 });
JobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Job = mongoose.models.Job || mongoose.model("Job", JobSchema);
