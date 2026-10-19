import mongoose from "mongoose";
import { Profile } from "../models/Profile.js";
import { Resume } from "../models/Resume.js";
import { isMongoReady } from "../config/database.js";
import { buildProfileMatchIndex } from "../services/jobs/incrementalMatching.js";

export interface ProfileRecord {
  _id?: string | mongoose.Types.ObjectId;
  userId: string | mongoose.Types.ObjectId;
  roles?: unknown[];
  skills?: string[];
  preferences?: Record<string, unknown>;
  careerProfile?: Record<string, unknown>;
  matchTokens?: string[];
  matchCountryCodes?: string[];
  version?: number;
  updatedAt?: Date;
  [key: string]: unknown;
}

export interface ResumeRecord {
  _id?: string | mongoose.Types.ObjectId;
  userId: string | mongoose.Types.ObjectId;
  s3Key?: string;
  fileHash?: string;
  extractedText?: string;
  parsedData?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
  [key: string]: unknown;
}

const inMemoryProfiles = new Map<string, ProfileRecord>();
const inMemoryResumes: ResumeRecord[] = [];

export const profileRepository = {
  async findByUserId(userId: string | mongoose.Types.ObjectId): Promise<ProfileRecord | null> {
    const uid = userId.toString();
    if (isMongoReady()) {
      return (await Profile.findOne({ userId }).lean()) as unknown as ProfileRecord | null;
    }
    return inMemoryProfiles.get(uid) || null;
  },

  async upsertProfile(userId: string | mongoose.Types.ObjectId, profileData: Partial<ProfileRecord>): Promise<ProfileRecord> {
    const uid = userId.toString();
    const updateData: Partial<ProfileRecord> = { ...profileData };
    // An extractor that finds no role entries must not erase previously
    // source-grounded role history. Explicit profile editing can still clear it.
    if (Array.isArray(updateData.roles) && updateData.roles.length === 0) delete updateData.roles;
    if (isMongoReady()) {
      const existingDoc = (await Profile.findOne({ userId })
        .select("skills roles preferences careerProfile")
        .lean()) as unknown as Partial<ProfileRecord> | null;
      const mergedForIndex = { ...(existingDoc || {}), ...updateData };
      const { matchTokens, matchCountryCodes } = buildProfileMatchIndex(mergedForIndex);
      return (await Profile.findOneAndUpdate(
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
      ).lean()) as unknown as ProfileRecord;
    }

    const existing = inMemoryProfiles.get(uid);
    const merged = { ...(existing || {}), ...updateData };
    const { matchTokens, matchCountryCodes } = buildProfileMatchIndex(merged);
    const updated: ProfileRecord = {
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

  async createResume(resumeData: Partial<ResumeRecord> & { userId: string | mongoose.Types.ObjectId }): Promise<ResumeRecord> {
    if (isMongoReady()) {
      try {
        const resume = new Resume(resumeData);
        return (await resume.save()).toObject() as unknown as ResumeRecord;
      } catch (error: unknown) {
        const mongoError = error as { code?: number };
        if (mongoError?.code !== 11000 || !resumeData.s3Key) throw error;
        const existing = (await Resume.findOne({
          userId: resumeData.userId,
          s3Key: resumeData.s3Key,
        }).lean()) as unknown as ResumeRecord | null;
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
    const newResume: ResumeRecord = {
      _id: new mongoose.Types.ObjectId().toString(),
      ...resumeData,
      createdAt: new Date(),
    };
    inMemoryResumes.push(newResume);
    return newResume;
  },

  async findResumesByUserId(userId: string | mongoose.Types.ObjectId): Promise<ResumeRecord[]> {
    const uid = userId.toString();
    if (isMongoReady()) {
      return (await Resume.find({ userId }).sort({ createdAt: -1 }).lean()) as unknown as ResumeRecord[];
    }
    return inMemoryResumes.filter((r) => r.userId.toString() === uid);
  },

  async findResumeByIdAndUserId(
    resumeId: string | mongoose.Types.ObjectId,
    userId: string | mongoose.Types.ObjectId,
  ): Promise<ResumeRecord | null> {
    if (isMongoReady()) {
      return (await Resume.findOne({ _id: resumeId, userId }).lean()) as unknown as ResumeRecord | null;
    }
    return (
      inMemoryResumes.find(
        (resume) =>
          resume._id?.toString() === resumeId.toString() &&
          resume.userId.toString() === userId.toString(),
      ) || null
    );
  },

  async findResumeByS3KeyAndUserId(
    s3Key: string,
    userId: string | mongoose.Types.ObjectId,
  ): Promise<ResumeRecord | null> {
    if (isMongoReady()) {
      return (await Resume.findOne({ s3Key, userId }).lean()) as unknown as ResumeRecord | null;
    }
    return (
      inMemoryResumes.find(
        (resume) => resume.s3Key === s3Key && resume.userId.toString() === userId.toString(),
      ) || null
    );
  },
};
