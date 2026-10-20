import mongoose, { Document, Model, Schema } from "mongoose";

const JobMatchReportSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  resumeId: { type: mongoose.Schema.Types.ObjectId, ref: "Resume", required: true },
  resumeHash: { type: String, required: true },
  jobKey: { type: String, required: true },
  scoreVersion: { type: String, required: true },
  job: {
    type: { type: String, enum: ["catalog", "application", "pasted"], required: true },
    catalogJobId: { type: String, default: "" },
    applicationId: { type: String, default: "" },
    title: { type: String, required: true, maxlength: 200 },
    company: { type: String, default: "", maxlength: 200 },
    description: { type: String, default: "", maxlength: 20000 },
    contentHash: { type: String, required: true },
    requirements: { type: [String], default: [] },
    tags: { type: [String], default: [] },
  },
  deterministicResult: { type: mongoose.Schema.Types.Mixed, required: true },
  ignoredKeywords: { type: [String], default: [] },
  suggestions: { type: mongoose.Schema.Types.Mixed, default: null },
  suggestionsPromptVersion: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: false });

JobMatchReportSchema.index(
  { userId: 1, resumeId: 1, jobKey: 1, scoreVersion: 1 },
  { unique: true, name: "job_match_report_idempotency" },
);
JobMatchReportSchema.index({ userId: 1, createdAt: -1 }, { name: "job_match_reports_by_owner" });

export const JobMatchReport = mongoose.models.JobMatchReport || mongoose.model("JobMatchReport", JobMatchReportSchema);
