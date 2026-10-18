import mongoose from "mongoose";

const CompanySchema = new mongoose.Schema({
  normalizedName: { type: String, required: true, unique: true, index: true },
  displayName: { type: String, required: true },
  aliases: { type: [String], default: [] },
  domains: { type: [String], default: [] },
  atsBoards: { type: [{ platform: String, slug: String, status: { type: String, enum: ["pending", "approved", "disabled"], default: "pending" } }], default: [] },
  sourceCounts: { type: Map, of: Number, default: {} },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  jobCount: { type: Number, default: 0, min: 0 },
  createdBy: { type: String, default: "job-catalog-backfill-v1" },
}, { timestamps: true, minimize: false });

CompanySchema.index({ domains: 1 });
CompanySchema.index({ "atsBoards.platform": 1, "atsBoards.slug": 1 });

export const Company = mongoose.models.Company || mongoose.model("Company", CompanySchema);

export function normalizeCompanyName(value = "") {
  return String(value).normalize("NFKC").replace(/&#0*38;|&amp;/gi, " and ").toLowerCase().replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
