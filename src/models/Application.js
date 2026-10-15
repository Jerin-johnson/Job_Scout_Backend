import mongoose from "mongoose";

const ApplicationSchema = new mongoose.Schema(
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
    company: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["saved", "applied", "screening", "interviewing", "offer", "rejected"],
      default: "saved",
      index: true,
    },
    priority: { type: String, enum: ["high", "medium", "low"], default: "medium", index: true },
    pinnedAt: { type: Date, default: null, index: true },
    archivedAt: { type: Date, default: null, index: true },
    archiveReason: {
      type: String,
      enum: ["withdrawn", "ghosted", "no_longer_interested", ""],
      default: "",
    },
    source: { type: String, trim: true, default: "" },
    location: { type: String, trim: true, default: "" },
    salaryMin: { type: Number, min: 0, default: null },
    salaryMax: { type: Number, min: 0, default: null },
    lastActivityAt: { type: Date, default: null, index: true },
    timeline: [
      {
        status: { type: String, required: true },
        changedAt: { type: Date, default: Date.now },
        note: { type: String, default: "" },
      },
    ],
    notes: {
      type: String,
      default: "",
    },
    jobUrl: { type: String, trim: true, default: "" },
    hrPhone: { type: String, trim: true, default: "" },
    companyEmail: { type: String, trim: true, lowercase: true, default: "" },
    reminderEnabled: { type: Boolean, default: false },
    reminderStatus: {
      type: String,
      enum: ["none", "scheduled", "processing", "sent", "mock", "failed"],
      default: "none",
      index: true,
    },
    reminderSentAt: { type: Date, default: null },
    reminderClaimId: { type: String, default: "" },
    nextFollowUpAt: {
      type: Date,
      default: null,
      index: true,
    },
    followUpDraft: {
      subject: { type: String, default: "" },
      body: { type: String, default: "" },
      status: {
        type: String,
        enum: ["none", "draft", "approved", "sent", "canceled"],
        default: "none",
      },
      sentAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
  },
);

ApplicationSchema.index({ userId: 1, status: 1 });
// Board reads are scoped to a user and exclude archived cards, then group by stage.
ApplicationSchema.index(
  { userId: 1, archivedAt: 1, status: 1 },
  { name: "application_board_by_stage" },
);
ApplicationSchema.index(
  { userId: 1, archivedAt: 1, nextFollowUpAt: 1 },
  { name: "application_board_follow_up" },
);
ApplicationSchema.index({ reminderStatus: 1, nextFollowUpAt: 1 });

export const Application =
  mongoose.models.Application || mongoose.model("Application", ApplicationSchema);
