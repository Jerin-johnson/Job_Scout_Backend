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

export const Application =
  mongoose.models.Application || mongoose.model("Application", ApplicationSchema);
