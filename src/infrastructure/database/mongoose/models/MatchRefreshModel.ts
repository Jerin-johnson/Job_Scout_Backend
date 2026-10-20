import mongoose, { Document, Model, Schema } from "mongoose";

const MatchRefreshSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    profileVersion: { type: Number, required: true },
    broaden: { type: Boolean, default: false },
    status: { type: String, enum: ["queued", "running", "done", "failed"], required: true },
    requestedAt: { type: Date, default: Date.now },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    nextAllowedAt: { type: Date, default: null },
    resultCount: { type: Number, default: 0 },
    emptyReason: { type: String, default: "" },
    broadenActions: { type: [String], default: [] },
    errorCode: { type: String, default: "" },
    attemptId: { type: String, required: true },
  },
  { timestamps: true },
);

MatchRefreshSchema.index({ userId: 1, profileVersion: 1 }, { unique: true });
MatchRefreshSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 604800 });

export const MatchRefresh =
  mongoose.models.MatchRefresh || mongoose.model("MatchRefresh", MatchRefreshSchema);
