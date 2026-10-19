import mongoose, { Document, Model, Schema } from "mongoose";

const ChatMessageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    role: { type: String, enum: ["user", "assistant", "system"], required: true },
    content: { type: String, required: true, maxlength: 40000 },
    sources: {
      type: [
        {
          id: { type: String },
          label: { type: String },
          tool: { type: String },
          detail: { type: String },
        },
      ],
      default: [],
    },
    toolStatus: { type: [String], default: [] },
    actions: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    model: { type: String, default: "" },
    tier: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ["streaming", "completed", "failed", "cancelled"],
      default: "completed",
    },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const ChatSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    threadId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      index: true,
    },
    checkpointThreadId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      default: "New conversation",
    },
    rollingSummary: {
      type: String,
      default: "",
      maxlength: 4000,
    },
    messages: {
      type: [ChatMessageSchema],
      default: [],
    },
    pageContext: {
      type: {
        kind: { type: String, enum: ["job", "application", "interview", "none"], default: "none" },
        id: { type: String, default: "" },
        label: { type: String, default: "" },
      },
      default: { kind: "none", id: "", label: "" },
    },
    lastStreamStatus: {
      type: String,
      enum: ["idle", "streaming", "completed", "failed", "cancelled"],
      default: "idle",
    },
    retentionDays: {
      type: Number,
      min: 1,
      max: 365,
      default: 90,
    },
    retentionExpiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 90 * 86_400_000),
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

ChatSessionSchema.index({ userId: 1, threadId: 1 }, { unique: true });
ChatSessionSchema.index({ userId: 1, isDeleted: 1, lastMessageAt: -1 });
ChatSessionSchema.index({ retentionExpiresAt: 1 }, { expireAfterSeconds: 0 });

export const ChatSession =
  mongoose.models.ChatSession || mongoose.model("ChatSession", ChatSessionSchema);
