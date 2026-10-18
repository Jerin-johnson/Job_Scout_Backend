import mongoose from "mongoose";

const JobDetailSchema = new mongoose.Schema(
  {
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true, unique: true },
    description: { type: String, default: "", maxlength: 24000 },
    requirements: { type: [String], default: [] },
    provenance: {
      type: [{ source: String, sourceJobId: String, canonicalUrl: String, attributionText: String, attributionUrl: String, seenAt: Date }],
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
