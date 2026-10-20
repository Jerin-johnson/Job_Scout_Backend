import mongoose, { Document, Model, Schema } from "mongoose";

const JobDetailProvenanceSchema = new mongoose.Schema(
  {
    source: { type: String, default: "" },
    sourceJobId: { type: String, default: "" },
    canonicalUrl: { type: String, default: "" },
    attributionText: { type: String, default: "" },
    attributionUrl: { type: String, default: "" },
    seenAt: { type: Date, default: null },
  },
  { _id: false },
);

const JobDetailSchema = new mongoose.Schema(
  {
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true, unique: true },
    description: { type: String, default: "", maxlength: 24000 },
    requirements: { type: [String], default: [] },
    provenance: {
      type: [JobDetailProvenanceSchema],
      default: [],
    },
    // Only normalized, display-safe detail fields belong here. Provider payloads
    // remain excluded unless that source's policy explicitly permits retention.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, minimize: true },
);

JobDetailSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "job_details_expiry" });

export const JobDetail = mongoose.models.JobDetail || mongoose.model("JobDetail", JobDetailSchema);
