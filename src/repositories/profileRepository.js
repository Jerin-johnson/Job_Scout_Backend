import mongoose from "mongoose";
import { Profile } from "../models/Profile.js";
import { Resume } from "../models/Resume.js";
import { isMongoReady } from "../config/database.js";

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
    if (isMongoReady()) {
      return Profile.findOneAndUpdate(
        { userId },
        {
          $set: {
            ...profileData,
            userId,
          },
          $inc: { version: 1 },
        },
        { upsert: true, new: true },
      ).lean();
    }

    const existing = inMemoryProfiles.get(uid);
    const updated = {
      _id: existing?._id || new mongoose.Types.ObjectId().toString(),
      userId: uid,
      ...(existing || {}),
      ...profileData,
      version: (existing?.version || 0) + 1,
      updatedAt: new Date(),
    };
    inMemoryProfiles.set(uid, updated);
    return updated;
  },

  async createResume(resumeData) {
    if (isMongoReady()) {
      const resume = new Resume(resumeData);
      return (await resume.save()).toObject();
    }
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
};
