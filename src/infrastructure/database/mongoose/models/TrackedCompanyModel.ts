import mongoose, { Document, Model, Schema } from "mongoose";

const TrackedCompanySchema = new mongoose.Schema(
  {
    platform: { type: String, enum: ["greenhouse", "lever", "ashby"], required: true, index: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, trim: true, default: "" },
    domain: { type: String, trim: true, default: "" },
    location: { type: String, trim: true, default: "" },
    tier: { type: String, trim: true, default: "" },
    careersUrl: { type: String, required: true, maxlength: 500 },
    status: {
      type: String,
      enum: ["pending", "approved", "disabled"],
      default: "pending",
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null,
    },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
TrackedCompanySchema.index({ platform: 1, slug: 1 }, { unique: true });

export const TrackedCompany =
  mongoose.models.TrackedCompany || mongoose.model("TrackedCompany", TrackedCompanySchema);
