import mongoose from "mongoose";

const JobSchema = new mongoose.Schema(
  {
    contentHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    recordHash: { type: String, default: "", index: true },
    identityKey: { type: String, index: true, sparse: true },
    sourceJobId: { type: String, index: true, sparse: true },
    canonicalUrl: { type: String, default: "", index: true },
    contentUpdatedAt: { type: Date, default: Date.now },
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
    structuredLocation: {
      countryCode: { type: String, default: "", uppercase: true, index: true },
      region: { type: String, default: "" },
      city: { type: String, default: "" },
      remoteScope: { type: String, enum: ["site", "city", "region", "country", "continent", "worldwide", "unknown"], default: "unknown" },
      eligibleCountryCodes: [{ type: String, uppercase: true }],
      workAuthorization: [{ type: String }],
    },
    occupationCodes: [{ type: String, index: true }],
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
    compensation: {
      originalText: { type: String, default: "" },
      currency: { type: String, default: "", uppercase: true },
      payPeriod: { type: String, enum: ["hour", "day", "month", "year", "contract", "unknown"], default: "unknown" },
      min: { type: Number, default: null },
      max: { type: Number, default: null },
      normalizedAnnualMin: { type: Number, default: null },
      normalizedAnnualMax: { type: Number, default: null },
      normalizedCurrency: { type: String, default: "", uppercase: true },
      normalizedAt: { type: Date, default: null },
    },
    provenance: [{
      source: { type: String, required: true },
      sourceJobId: { type: String, default: "" },
      canonicalUrl: { type: String, default: "" },
      attributionText: { type: String, default: "" },
      attributionUrl: { type: String, default: "" },
      seenAt: { type: Date, default: Date.now },
    }],
    status: { type: String, enum: ["active", "stale", "closed"], default: "active", index: true },
    firstSeenAt: { type: Date, default: Date.now, index: true },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    sourceExpiresAt: { type: Date, default: null },
    sourceCheckedAt: { type: Date, default: null },
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
JobSchema.index({ identityKey: 1 }, { unique: true, sparse: true, name: "job_identity_unique" });
JobSchema.index({ status: 1, "structuredLocation.countryCode": 1, remoteType: 1, expiresAt: 1, postedAt: -1 }, { name: "job_candidate_location_mode" });
JobSchema.index({ status: 1, expiresAt: 1, postedAt: -1 }, { name: "job_candidate_active_recent" });
JobSchema.index({ status: 1, sourceBoard: 1, postedAt: -1, _id: 1, expiresAt: 1 }, { name: "job_candidate_recent_feed" });
JobSchema.index({ status: 1, expiresAt: 1, occupationCodes: 1, postedAt: -1 }, { name: "job_candidate_occupation" });
JobSchema.index({ sourceBoard: 1, status: 1, expiresAt: 1 }, { name: "job_source_coverage" });
JobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Job = mongoose.models.Job || mongoose.model("Job", JobSchema);
