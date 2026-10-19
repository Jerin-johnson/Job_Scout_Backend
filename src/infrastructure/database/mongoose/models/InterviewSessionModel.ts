import mongoose, { Document, Model, Schema } from "mongoose";

const InterviewSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    resumeId: { type: mongoose.Schema.Types.ObjectId, ref: "Resume", required: true },
    resumeFileHash: { type: String, default: null, select: false },
    role: { type: String, required: true, trim: true, maxlength: 160 },
    level: { type: String, enum: ["fresher", "mid", "senior"], required: true },
    mode: {
      type: String,
      enum: ["hr", "founder", "technical", "behavioral", "aptitude_case", "mixed"],
      required: true,
    },
    durationMinutes: { type: Number, enum: [10, 20, 30], required: true },
    jobDescription: { type: String, default: "", maxlength: 12000 },
    status: {
      type: String,
      enum: ["ready", "in_progress", "completed", "expired", "cancelled"],
      default: "ready",
      index: true,
    },
    consent: {
      acceptedAt: { type: Date, required: true },
      version: { type: String, required: true },
    },
    questionPlan: { type: [String], default: [] },
    currentQuestionIndex: { type: Number, default: 0 },
    answeredQuestionIndexes: { type: [Number], default: [] },
    nextSequence: { type: Number, default: 0 },
    estimatedTokensUsed: { type: Number, default: 0 },
    tokenCap: { type: Number, required: true },
    reportTokenReserve: { type: Number, default: 2000 },
    startedAt: Date,
    endsAt: Date,
    completedAt: Date,
    isFreeTrial: { type: Boolean, default: false },
    quotaReservationDay: { type: String, default: null },
    activeAnswerClaimIndex: { type: Number, default: undefined },
    activeAnswerClaimKey: { type: String, default: undefined },
    activeAnswerClaimExpiresAt: { type: Date, default: undefined },
    promptVersion: { type: String, default: "2026-10-15-v1" },
    rollingSummary: { type: String, default: "" },
    reportStatus: { type: String, enum: ["pending", "generated", "fallback", null], default: null },
    pinnedAt: { type: Date, default: null },
    retentionExpiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

InterviewSessionSchema.index({ userId: 1, createdAt: -1 });
InterviewSessionSchema.index({ retentionExpiresAt: 1 }, { expireAfterSeconds: 0 });
export const InterviewSession =
  mongoose.models.InterviewSession || mongoose.model("InterviewSession", InterviewSessionSchema);
