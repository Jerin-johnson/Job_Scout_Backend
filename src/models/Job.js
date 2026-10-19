import mongoose from "mongoose";

const JobSchema = new mongoose.Schema(
  {
    contentHash: {
      type: String,
      required: true,
      index: true,
    },
    recordHash: { type: String, default: "", index: true },
    identityKey: { type: String, index: true, sparse: true },
    sourceJobId: { type: String, index: true, sparse: true },
    canonicalUrl: { type: String, default: "", index: true },
    groupKey: { type: String, default: "", index: true },
    canonicalJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      default: null,
      index: true,
    },
    variants: { type: [{ source: String, url: String, seenAt: Date }], default: [] },
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
      remoteScope: {
        type: String,
        enum: ["site", "city", "region", "country", "continent", "worldwide", "unknown"],
        default: "unknown",
      },
      eligibleCountryCodes: [{ type: String, uppercase: true }],
      workAuthorization: [{ type: String }],
    },
    eligibility: {
      version: { type: Number, default: 1 },
      countries: [{ type: String, uppercase: true }],
      remoteScope: { type: String, default: "unknown" },
      sponsorship: { type: Boolean, default: false },
      workAuthorizationRequired: { type: Boolean, default: false },
      confidence: { type: Number, default: 0, min: 0, max: 1 },
      evidence: { type: String, default: "", maxlength: 180 },
    },
    occupationCodes: [{ type: String, index: true }],
    sourceCategory: { type: String, default: "", maxlength: 160 },
    occupation: { type: String, default: "unclassified", index: true },
    occupationConfidence: { type: Number, default: 0, min: 0, max: 1 },
    occupationFeaturesVersion: { type: Number, default: 0, index: true },
    normalizedTitle: { type: String, default: "", index: true },
    // Deterministic rules-only features; absent legacy values are computed at read time.
    features: { type: mongoose.Schema.Types.Mixed, default: undefined },
    featuresVersion: { type: Number, default: 0, index: true },
    searchTokens: [{ type: String }],
    applyClickCount: { type: Number, default: 0, min: 0 },
    // Aggregate safety reports by reason only; never retain reporter identity.
    reportCounts: { type: Map, of: Number, default: () => new Map() },
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
      payPeriod: {
        type: String,
        enum: ["hour", "day", "month", "year", "contract", "unknown"],
        default: "unknown",
      },
      min: { type: Number, default: null },
      max: { type: Number, default: null },
      normalizedAnnualMin: { type: Number, default: null },
      normalizedAnnualMax: { type: Number, default: null },
      normalizedCurrency: { type: String, default: "", uppercase: true },
      normalizedAt: { type: Date, default: null },
    },
    provenance: [
      new mongoose.Schema(
        {
          source: { type: String, required: true },
          sourceJobId: { type: String, default: "" },
          canonicalUrl: { type: String, default: "" },
          attributionText: { type: String, default: "" },
          attributionUrl: { type: String, default: "" },
          seenAt: { type: Date, default: Date.now },
        },
        { _id: false },
      ),
    ],
    status: { type: String, enum: ["active", "stale", "closed"], default: "active", index: true },
    repostCount: { type: Number, default: 0, min: 0 },
    firstSeenAt: { type: Date, default: Date.now, index: true },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    sourceExpiresAt: { type: Date, default: null },
    sourceCheckedAt: { type: Date, default: null },
    requirements: [{ type: String }],
    tags: [{ type: String }],
    rawDescription: {
      type: String,
      default: "",
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
      default: null,
      index: true,
    },
    postedDateKnown: { type: Boolean, default: false, index: true },
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
JobSchema.index(
  { status: 1, "structuredLocation.countryCode": 1, remoteType: 1, expiresAt: 1, postedAt: -1 },
  { name: "job_candidate_location_mode" },
);
JobSchema.index({ status: 1, expiresAt: 1, postedAt: -1 }, { name: "job_candidate_active_recent" });
JobSchema.index(
  { status: 1, postedAt: -1, _id: 1 },
  { name: "job_catalog_cursor", partialFilterExpression: { status: "active" } },
);
JobSchema.index(
  { status: 1, sourceBoard: 1, postedAt: -1, _id: 1, expiresAt: 1 },
  { name: "job_candidate_recent_feed" },
);
JobSchema.index(
  { status: 1, expiresAt: 1, occupationCodes: 1, postedAt: -1 },
  { name: "job_candidate_occupation" },
);
JobSchema.index({ sourceBoard: 1, status: 1, expiresAt: 1 }, { name: "job_source_coverage" });
JobSchema.index({ groupKey: 1, status: 1, expiresAt: 1 }, { name: "job_dedup_group_active" });
JobSchema.index(
  { occupation: 1, status: 1, expiresAt: 1 },
  { name: "job_candidate_occupation_family" },
);
JobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
JobSchema.index(
  { "features.skills": 1, status: 1, expiresAt: 1 },
  { name: "job_features_skills_active" },
);
JobSchema.index(
  { "features.titleTokens": 1, status: 1, expiresAt: 1 },
  { name: "job_features_title_active" },
);
// Bounded discovery queries use status + one multikey field. Separate indexes
// are required because MongoDB cannot compound-index multiple array fields.
JobSchema.index(
  { status: 1, "features.skills": 1, postedAt: -1 },
  { name: "job_candidate_skills_recent" },
);
JobSchema.index(
  { status: 1, "features.titleTokens": 1, postedAt: -1 },
  { name: "job_candidate_title_recent" },
);
JobSchema.index(
  { status: 1, "features.companyTokens": 1, postedAt: -1 },
  { name: "job_candidate_company_recent" },
);
JobSchema.index(
  { status: 1, occupationCodes: 1, postedAt: -1 },
  { name: "job_candidate_occupation_recent" },
);
JobSchema.index(
  { status: 1, "structuredLocation.eligibleCountryCodes": 1, postedAt: -1 },
  { name: "job_candidate_eligible_country_recent" },
);
JobSchema.index(
  { status: 1, searchTokens: 1, postedAt: -1, _id: 1 },
  { name: "job_search_tokens_recent" },
);

export const Job = mongoose.models.Job || mongoose.model("Job", JobSchema);
