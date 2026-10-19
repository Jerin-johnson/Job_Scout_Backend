import mongoose, { Document, Model, Schema } from "mongoose";

export interface ITimelineEvent {
  status: string;
  changedAt: Date;
  note?: string;
}

export interface IFollowUpDraft {
  subject: string;
  body: string;
  status: "none" | "draft" | "approved" | "sent" | "canceled";
  sentAt?: Date | null;
}

export interface IApplicationDocument extends Document {
  userId: mongoose.Types.ObjectId;
  jobId: string;
  company: string;
  role: string;
  status: "saved" | "applied" | "screening" | "interviewing" | "offer" | "rejected";
  priority: "high" | "medium" | "low";
  pinnedAt?: Date | null;
  archivedAt?: Date | null;
  archiveReason?: "withdrawn" | "ghosted" | "no_longer_interested" | "";
  source?: string;
  location?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  lastActivityAt?: Date | null;
  timeline: ITimelineEvent[];
  notes?: string;
  jobUrl?: string;
  hrPhone?: string;
  companyEmail?: string;
  reminderEnabled: boolean;
  reminderStatus: "none" | "scheduled" | "processing" | "sent" | "mock" | "failed";
  reminderSentAt?: Date | null;
  reminderClaimId?: string;
  nextFollowUpAt?: Date | null;
  followUpDraft?: IFollowUpDraft;
  createdAt: Date;
  updatedAt: Date;
}

export const ApplicationSchema = new Schema<IApplicationDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
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

export const ApplicationModel: Model<IApplicationDocument> =
  (mongoose.models.Application as Model<IApplicationDocument>) ||
  mongoose.model<IApplicationDocument>("Application", ApplicationSchema);
