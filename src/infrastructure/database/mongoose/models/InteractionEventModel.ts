import mongoose, { Document, Model, Schema } from "mongoose";

const InteractionEventSchema = new mongoose.Schema({
  actorKey: { type: String, required: true, index: true },
  event: { type: String, required: true, enum: ["impression", "zero_result", "click", "save", "apply_click", "hide", "match_feedback", "resume_match_used"] },
  count: { type: Number, required: true, min: 1, max: 500, default: 1 },
  source: { type: String, default: "unknown", maxlength: 40 },
  occupation: { type: String, default: "unknown", maxlength: 40 },
  country: { type: String, default: "unknown", maxlength: 2 },
  scoreBand: { type: String, enum: ["strong", "good", "fair", "low", "unknown"], default: "unknown" },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 },
}, { versionKey: false });

InteractionEventSchema.index({ createdAt: -1, event: 1 });
InteractionEventSchema.index({ source: 1, event: 1, createdAt: -1 });

export const InteractionEvent = mongoose.models.InteractionEvent || mongoose.model("InteractionEvent", InteractionEventSchema);
