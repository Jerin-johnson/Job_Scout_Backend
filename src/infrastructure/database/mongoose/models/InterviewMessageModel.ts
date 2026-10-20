import mongoose, { Document, Model, Schema } from "mongoose";

const InterviewMessageSchema = new mongoose.Schema(
  {
    interviewId: { type: mongoose.Schema.Types.ObjectId, ref: "InterviewSession", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sequence: { type: Number, required: true },
    promptIndex: { type: Number, min: 0, default: null },
    role: { type: String, enum: ["interviewer", "candidate"], required: true },
    content: { type: String, required: true },
    source: { type: String, enum: ["text", "audio", "system"], default: "text" },
    audioDurationMs: { type: Number, min: 0, default: null },
    startedAtMs: { type: Number, min: 0, default: null },
    idempotencyKey: { type: String, default: null },
    requestHash: { type: String, default: null },
    claimExpiresAt: { type: Date, default: null },
    claimKey: { type: String, default: null },
    respondsToMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InterviewMessage",
      default: null,
    },
    evaluation: { type: mongoose.Schema.Types.Mixed, default: null },
    idempotentResponse: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
    createdAt: { type: Date, default: Date.now },
    retentionExpiresAt: { type: Date, default: null },
  },
  { versionKey: false },
);

InterviewMessageSchema.index({ interviewId: 1, sequence: 1 }, { unique: true });
InterviewMessageSchema.index(
  { interviewId: 1, promptIndex: 1 },
  { unique: true, partialFilterExpression: { promptIndex: { $gte: 0 } } },
);
InterviewMessageSchema.index(
  { interviewId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);
InterviewMessageSchema.index({ userId: 1, interviewId: 1, createdAt: 1 });
InterviewMessageSchema.index({ retentionExpiresAt: 1 }, { expireAfterSeconds: 0 });
InterviewMessageSchema.index(
  { interviewId: 1, respondsToMessageId: 1 },
  { unique: true, partialFilterExpression: { respondsToMessageId: { $type: "objectId" } } },
);
export const InterviewMessage =
  mongoose.models.InterviewMessage || mongoose.model("InterviewMessage", InterviewMessageSchema);
