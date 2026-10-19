import mongoose from "mongoose";
import { Profile } from "../models/Profile.js";
import { Resume } from "../models/Resume.js";
import { isMongoReady } from "../config/database.js";
import { buildProfileMatchIndex } from "../services/jobs/incrementalMatching.js";

const inMemoryProfiles = new Map();
const inMemoryResumes = [];

export const profileRepository = {
  async findByUserId(userId) {
    const uid = userId.toString();
    if (isMongoReady()) {
      return Profile.findOne({ userId }).lean();
    }
    return inMemoryProfiles.get(uid) || null;
  },

  async upsertProfile(userId, profileData) {
    const uid = userId.toString();
    const updateData = { ...profileData };
    // An extractor that finds no role entries must not erase previously
    // source-grounded role history. Explicit profile editing can still clear it.
    if (Array.isArray(updateData.roles) && updateData.roles.length === 0) delete updateData.roles;
    if (isMongoReady()) {
      const existingDoc = await Profile.findOne({ userId })
        .select("skills roles preferences careerProfile")
        .lean();
      const mergedForIndex = { ...(existingDoc || {}), ...updateData };
      const { matchTokens, matchCountryCodes } = buildProfileMatchIndex(mergedForIndex);
      return Profile.findOneAndUpdate(
        { userId },
        {
          $set: {
            ...updateData,
            matchTokens,
            matchCountryCodes,
            userId,
          },
          $inc: { version: 1 },
        },
        { upsert: true, new: true },
      ).lean();
    }

    const existing = inMemoryProfiles.get(uid);
    const merged = { ...(existing || {}), ...updateData };
    const { matchTokens, matchCountryCodes } = buildProfileMatchIndex(merged);
    const updated = {
      _id: existing?._id || new mongoose.Types.ObjectId().toString(),
      userId: uid,
      ...merged,
      matchTokens,
      matchCountryCodes,
      version: (existing?.version || 0) + 1,
      updatedAt: new Date(),
    };
    inMemoryProfiles.set(uid, updated);
    return updated;
  },

  async createResume(resumeData) {
    if (isMongoReady()) {
      try {
        const resume = new Resume(resumeData);
        return (await resume.save()).toObject();
      } catch (error) {
        if (error?.code !== 11000 || !resumeData.s3Key) throw error;
        const existing = await Resume.findOne({
          userId: resumeData.userId,
          s3Key: resumeData.s3Key,
        }).lean();
        if (!existing) throw error;
        return existing;
      }
    }
    const existing = inMemoryResumes.find(
      (resume) =>
        resume.userId.toString() === resumeData.userId.toString() &&
        resume.s3Key === resumeData.s3Key,
    );
    if (existing) return existing;
    const newResume = {
      _id: new mongoose.Types.ObjectId().toString(),
      ...resumeData,
      createdAt: new Date(),
    };
    inMemoryResumes.push(newResume);
    return newResume;
  },

  async findResumesByUserId(userId) {
    const uid = userId.toString();
    if (isMongoReady()) {
      return Resume.find({ userId }).sort({ createdAt: -1 }).lean();
    }
    return inMemoryResumes.filter((r) => r.userId.toString() === uid);
  },

  async findResumeByIdAndUserId(resumeId, userId) {
    if (isMongoReady()) {
      return Resume.findOne({ _id: resumeId, userId }).lean();
    }
    return (
      inMemoryResumes.find(
        (resume) =>
          resume._id.toString() === resumeId.toString() &&
          resume.userId.toString() === userId.toString(),
      ) || null
    );
  },

  async findResumeByS3KeyAndUserId(s3Key, userId) {
    if (isMongoReady()) {
      return Resume.findOne({ s3Key, userId }).lean();
    }
    return (
      inMemoryResumes.find(
        (resume) => resume.s3Key === s3Key && resume.userId.toString() === userId.toString(),
      ) || null
    );
  },
};
