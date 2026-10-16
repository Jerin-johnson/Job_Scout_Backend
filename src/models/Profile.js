import mongoose from "mongoose";

const ProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
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
    version: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  },
);

export const Profile = mongoose.models.Profile || mongoose.model("Profile", ProfileSchema);
