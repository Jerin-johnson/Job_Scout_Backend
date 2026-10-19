import mongoose, { Document, Model, Schema } from "mongoose";

export interface IRoleFactSubdoc {
  factId: string;
  title: string;
  company: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  achievements?: Array<{ factId: string; bullet: string; metrics?: string }>;
}

export interface ISkillFactSubdoc {
  factId: string;
  name: string;
  category?: string;
  proficiencyYears?: number;
}

export interface IEducationFactSubdoc {
  factId: string;
  degree: string;
  institution?: string;
  graduationYear?: number | null;
}

export interface IProfilePreferences {
  targetRoles?: string[];
  minimumSalaryUsd?: number;
  preferredLocations?: string[];
  preferredCountryCodes?: string[];
  occupationCodes?: string[];
  remotePreference?: "remote" | "hybrid" | "onsite" | "any";
}

export interface IProfileDocument extends Document {
  userId: mongoose.Types.ObjectId;
  roles: IRoleFactSubdoc[];
  skills: ISkillFactSubdoc[];
  education: IEducationFactSubdoc[];
  preferences: IProfilePreferences;
  careerProfile?: Record<string, unknown>;
  matchTokens: string[];
  matchCountryCodes: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const ProfileSchema = new Schema<IProfileDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    roles: [
      {
        factId: { type: String, required: true },
        title: { type: String, required: true },
        company: { type: String, required: true },
        startDate: { type: String, default: "" },
        endDate: { type: String, default: "" },
        isCurrent: { type: Boolean, default: false },
        achievements: [
          {
            factId: { type: String, required: true },
            bullet: { type: String, required: true },
            metrics: { type: String, default: "" },
          },
        ],
      },
    ],
    skills: [
      {
        factId: { type: String, required: true },
        name: { type: String, required: true },
        category: { type: String, default: "general" },
        proficiencyYears: { type: Number, default: 1 },
      },
    ],
    education: [
      {
        factId: { type: String, required: true },
        degree: { type: String, required: true },
        institution: { type: String, default: "" },
        graduationYear: { type: Number, default: null },
      },
    ],
    preferences: {
      targetRoles: [{ type: String }],
      minimumSalaryUsd: { type: Number, default: 0 },
      preferredLocations: [{ type: String }],
      preferredCountryCodes: [{ type: String, uppercase: true }],
      occupationCodes: [{ type: String }],
      remotePreference: {
        type: String,
        enum: ["remote", "hybrid", "onsite", "any"],
        default: "any",
      },
    },
    careerProfile: { type: Schema.Types.Mixed, default: undefined },
    matchTokens: {
      type: [{ type: String }],
      default: [],
    },
    matchCountryCodes: {
      type: [{ type: String, uppercase: true }],
      default: [],
    },
    version: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  },
);

ProfileSchema.index({ matchTokens: 1, updatedAt: -1 }, { name: "profile_match_tokens_idx" });

export const ProfileModel: Model<IProfileDocument> =
  (mongoose.models.Profile as Model<IProfileDocument>) ||
  mongoose.model<IProfileDocument>("Profile", ProfileSchema);

export { ProfileModel as Profile };

