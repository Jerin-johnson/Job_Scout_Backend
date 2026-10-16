import mongoose from "mongoose";

const MatchSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      index: true,
    },
    score: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    rationale: {
      type: String,
      required: true,
    },
    matchingSkills: [{ type: String }],
    missingSkills: [{ type: String }],
    scoreBand: { type: String, enum: ["strong", "good", "fair", "low"], default: "low" },
    scoreVersion: { type: String, default: "legacy" },
    scoreBreakdown: { type: mongoose.Schema.Types.Mixed, default: {} },
    reasons: [{ type: String }],
    features: { type: mongoose.Schema.Types.Mixed, default: {} },
    title: { type: String, default: "" },
    company: { type: String, default: "" },
    location: { type: String, default: "" },
    sourceUrl: { type: String, default: "" },
    sourceBoard: { type: String, default: "" },
    salaryRange: { type: mongoose.Schema.Types.Mixed, default: undefined },
    postedAt: { type: Date, default: null },
    locationTier: { type: Number, min: 1, max: 4, default: null },
    locationLabel: { type: String, default: "" },
    userFeedback: {
      type: String,
      enum: ["thumbs_up", "thumbs_down", null],
      default: null,
    },
    feedbackReason: {
      type: String,
      default: "",
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
  },
);

// Compound index to ensure uniqueness per user and job, and fast sorted reads
MatchSchema.index({ userId: 1, jobId: 1 }, { unique: true });
MatchSchema.index({ userId: 1, score: -1, createdAt: -1 });

export const Match = mongoose.models.Match || mongoose.model("Match", MatchSchema);
