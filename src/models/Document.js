import mongoose from "mongoose";

const DocumentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    jobId: {
      type: String,
      required: true,
      index: true,
    },
    jobTitle: {
      type: String,
      default: "",
    },
    company: {
      type: String,
      default: "",
    },
    type: {
      type: String,
      enum: ["tailored_resume", "cover_letter"],
      default: "tailored_resume",
      index: true,
    },
    status: {
      type: String,
      enum: ["draft", "awaiting_approval", "approved", "rejected"],
      default: "awaiting_approval",
      index: true,
    },
    tailoredBullets: [
      {
        factId: { type: String, required: true },
        originalBullet: { type: String, default: "" },
        tailoredBullet: { type: String, required: true },
        isVerified: { type: Boolean, default: true },
      },
    ],
    coverLetterText: {
      type: String,
      default: "",
    },
    atsMatchScore: {
      type: Number,
      default: 0,
    },
    atsKeywordsCovered: [{ type: String }],
    pdfStorageUrl: {
      type: String,
      default: "",
    },
    docxStorageUrl: {
      type: String,
      default: "",
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

export const Document =
  mongoose.models.Document || mongoose.model("Document", DocumentSchema);
