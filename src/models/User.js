import mongoose from "mongoose";
import { PLANS, ROLES } from "../shared/constants/plans.js";

const RefreshTokenSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true },
    familyId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    isRevoked: { type: Boolean, default: false },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      default: null,
    },
    googleId: {
      type: String,
      sparse: true,
      index: true,
    },
    name: {
      type: String,
      trim: true,
      default: "",
    },
    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.USER,
      index: true,
    },
    plan: {
      type: String,
      enum: Object.values(PLANS),
      default: PLANS.FREE,
      index: true,
    },
    planSource: {
      type: String,
      enum: ["manual", "razorpay", "admin"],
      default: "manual",
    },
    planVersion: {
      type: Number,
      default: 1,
    },
    subscriptionId: {
      type: String,
      default: null,
    },
    subscriptionProvider: {
      type: String,
      enum: ["razorpay", null],
      default: null,
    },
    subscriptionStatus: {
      type: String,
      enum: ["active", "past_due", "canceled", "incomplete", "trialing", null],
      default: null,
    },
    gracePeriodUntil: {
      type: Date,
      default: null,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
      default: null,
    },
    refreshTokens: [RefreshTokenSchema],
    memoryPaused: {
      type: Boolean,
      default: false,
    },
    timezone: { type: String, default: "UTC", trim: true, maxlength: 64 },
    mockInterviewTrialUsedAt: { type: Date, default: undefined },
    mockInterviewTrialSessionId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
    mockInterviewQuotaDay: { type: String, default: undefined },
    mockInterviewQuotaCount: { type: Number, default: 0 },
    mockInterviewQuotaSessionIds: {
      type: [mongoose.Schema.Types.ObjectId],
      default: undefined,
    },
    profileVersion: {
      type: Number,
      default: 1,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

UserSchema.index({ email: 1, isDeleted: 1 });

export const User = mongoose.models.User || mongoose.model("User", UserSchema);
