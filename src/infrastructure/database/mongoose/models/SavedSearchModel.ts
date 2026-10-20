import mongoose, { Document, Model, Schema } from "mongoose";
import { randomBytes } from "node:crypto";

const SavedSearchSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    filters: {
      q: { type: String, trim: true, maxlength: 120, default: "" },
      location: { type: String, trim: true, maxlength: 120, default: "" },
      countryCode: { type: String, trim: true, uppercase: true, maxlength: 2, default: "" },
      occupation: { type: String, trim: true, lowercase: true, maxlength: 60, default: "" },
      remoteType: {
        type: String,
        enum: ["", "remote", "hybrid", "onsite"],
        default: "",
      },
      source: { type: String, trim: true, lowercase: true, maxlength: 60, default: "" },
      postedWithinDays: { type: Number, min: 0, max: 365, default: 0 },
      minimumSalaryInr: { type: Number, min: 0, default: null },
      eligibility: {
        type: String,
        enum: ["", "eligible", "unknown"],
        default: "",
      },
      showAnyway: { type: Boolean, default: false },
    },
    alertFrequency: {
      type: String,
      enum: ["none", "instant", "daily"],
      default: "daily",
      index: true,
    },
    alertChannels: {
      type: [{ type: String, enum: ["in_app", "email"] }],
      default: ["in_app", "email"],
    },
    quietHours: {
      enabled: { type: Boolean, default: false },
      startHourUtc: { type: Number, min: 0, max: 23, default: 22 },
      endHourUtc: { type: Number, min: 0, max: 23, default: 7 },
    },
    enabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    unsubscribeToken: {
      type: String,
      default: () => randomBytes(24).toString("hex"),
      index: true,
    },
    sentJobIds: {
      type: [{ type: String }],
      default: [],
    },
    lastAlertedAt: {
      type: Date,
      default: null,
    },
    alertsSentToday: {
      type: Number,
      default: 0,
      min: 0,
    },
    alertWindowDay: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

SavedSearchSchema.index({ userId: 1, createdAt: -1 }, { name: "saved_search_user_created_idx" });
SavedSearchSchema.index(
  { enabled: 1, alertFrequency: 1, lastAlertedAt: 1 },
  { name: "saved_search_alert_schedule_idx" },
);

export const SavedSearch =
  mongoose.models.SavedSearch || mongoose.model("SavedSearch", SavedSearchSchema);
