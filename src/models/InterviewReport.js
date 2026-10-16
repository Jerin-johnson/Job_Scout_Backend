import mongoose from "mongoose";

const InterviewReportSchema = new mongoose.Schema(
  {
    interviewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InterviewSession",
      required: true,
      unique: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    report: { type: mongoose.Schema.Types.Mixed, required: true },
    schemaVersion: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    retentionExpiresAt: { type: Date, default: null },
  },
  { versionKey: false },
);
InterviewReportSchema.index({ retentionExpiresAt: 1 }, { expireAfterSeconds: 0 });

export const InterviewReport =
  mongoose.models.InterviewReport || mongoose.model("InterviewReport", InterviewReportSchema);
