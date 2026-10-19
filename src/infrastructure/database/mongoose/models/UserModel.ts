import mongoose, { Document, Model, Schema } from "mongoose";
import { PLANS, ROLES } from "../../../../shared/constants/plans.js";

export interface IRefreshTokenSubdoc {
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  isRevoked: boolean;
}

export interface IUserDocument extends Document {
  email: string;
  passwordHash: string | null;
  googleId?: string | null;
  name: string;
  preferredName?: string;
  role: string;
  plan: string;
  planSource: string;
  planVersion: number;
  subscriptionId?: string | null;
  subscriptionProvider?: string | null;
  subscriptionStatus?: string | null;
  gracePeriodUntil?: Date | null;
  failedLoginAttempts: number;
  lockUntil?: Date | null;
  refreshTokens: IRefreshTokenSubdoc[];
  memoryPaused: boolean;
  resumeAiConsent?: { acceptedAt?: Date | null; version?: string | null };
  jobAnalyticsConsent?: { acceptedAt?: Date | null; version?: string | null };
  memoryConsent?: { acceptedAt?: Date | null; version?: string | null };
  chatRetentionDays?: number;
  timezone?: string;
  mockInterviewTrialUsedAt?: Date;
  mockInterviewTrialSessionId?: mongoose.Types.ObjectId;
  mockInterviewQuotaDay?: string;
  mockInterviewQuotaCount?: number;
  mockInterviewQuotaSessionIds?: mongoose.Types.ObjectId[];
  profileVersion: number;
  isDeleted: boolean;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const RefreshTokenSchema = new Schema<IRefreshTokenSubdoc>(
  {
    tokenHash: { type: String, required: true },
    familyId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    isRevoked: { type: Boolean, default: false },
  },
  { _id: false },
);

export const UserSchema = new Schema<IUserDocument>(
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
    preferredName: { type: String, trim: true, maxlength: 80, default: "" },
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
    resumeAiConsent: {
      acceptedAt: { type: Date, default: null },
      version: { type: String, default: null },
    },
    jobAnalyticsConsent: {
      acceptedAt: { type: Date, default: null },
      version: { type: String, default: null },
    },
    memoryConsent: {
      acceptedAt: { type: Date, default: null },
      version: { type: String, default: null },
    },
    chatRetentionDays: {
      type: Number,
      min: 1,
      max: 365,
      default: 90,
    },
    timezone: { type: String, default: "UTC", trim: true, maxlength: 64 },
    mockInterviewTrialUsedAt: { type: Date, default: undefined },
    mockInterviewTrialSessionId: { type: Schema.Types.ObjectId, default: undefined },
    mockInterviewQuotaDay: { type: String, default: undefined },
    mockInterviewQuotaCount: { type: Number, default: 0 },
    mockInterviewQuotaSessionIds: {
      type: [Schema.Types.ObjectId],
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

export const UserModel: Model<IUserDocument> =
  (mongoose.models.User as Model<IUserDocument>) ||
  mongoose.model<IUserDocument>("User", UserSchema);
