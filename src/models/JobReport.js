import mongoose from "mongoose";

const JobReportSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
  reason: { type: String, enum: ["expired", "broken_link", "misleading", "spam", "other"], required: true },
  status: { type: String, enum: ["pending", "reviewed"], default: "pending", index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
JobReportSchema.index({ userId: 1, jobId: 1 }, { unique: true, name: "job_report_once_per_user" });
JobReportSchema.index({ status: 1, createdAt: -1 });

export const JobReport = mongoose.models.JobReport || mongoose.model("JobReport", JobReportSchema);
