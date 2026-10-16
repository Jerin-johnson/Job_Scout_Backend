import mongoose from "mongoose";

const ResumeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    fileHash: {
      type: String,
      required: true,
      index: true,
    },
    originalFilename: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    s3Key: {
      type: String,
      required: true,
    },
    encryptedRawText: {
      cipherText: { type: String, required: true },
      iv: { type: String, required: true },
      tag: { type: String, required: true },
      keyVersion: { type: String, default: "v1" },
    },
    parsedFactsCount: {
      type: Number,
      default: 0,
    },
    factsSummary: {
      roles: { type: Number, default: 0 },
      skills: { type: Number, default: 0 },
      education: { type: Number, default: 0 },
      totalFacts: { type: Number, default: 0 },
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  },
);

ResumeSchema.index({ userId: 1, s3Key: 1 }, { unique: true });

export const Resume = mongoose.models.Resume || mongoose.model("Resume", ResumeSchema);
