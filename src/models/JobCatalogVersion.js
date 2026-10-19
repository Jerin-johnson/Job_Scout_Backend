import mongoose from "mongoose";

const JobCatalogVersionSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true, required: true },
    version: { type: Number, default: 1, min: 1, required: true },
  },
  { timestamps: true, versionKey: false },
);

export const JobCatalogVersion = mongoose.models.JobCatalogVersion ||
  mongoose.model("JobCatalogVersion", JobCatalogVersionSchema);
