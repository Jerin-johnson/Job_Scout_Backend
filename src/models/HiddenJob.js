import mongoose from "mongoose";

const HiddenJobSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
  jobId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Job" },
  createdAt: { type: Date, default: Date.now },
});
HiddenJobSchema.index({ userId: 1, jobId: 1 }, { unique: true, name: "hidden_job_by_user" });
HiddenJobSchema.index({ userId: 1, createdAt: -1 });

export const HiddenJob = mongoose.models.HiddenJob || mongoose.model("HiddenJob", HiddenJobSchema);
