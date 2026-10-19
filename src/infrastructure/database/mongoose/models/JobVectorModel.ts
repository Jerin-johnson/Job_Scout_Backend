import mongoose, { Document, Model, Schema } from "mongoose";

const JobVectorSchema = new mongoose.Schema(
  {
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true, unique: true },
    vector: { type: [Number], required: true, select: false },
    provider: { type: String, default: "legacy" },
    model: { type: String, default: "unknown" },
    dimension: { type: Number, required: true, min: 1 },
    migratedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: true },
);

export const JobVector = mongoose.models.JobVector || mongoose.model("JobVector", JobVectorSchema);
