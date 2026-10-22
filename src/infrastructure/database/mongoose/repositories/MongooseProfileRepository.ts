import { injectable } from "tsyringe";
import mongoose from "mongoose";
import { BaseMongooseRepository } from "./BaseMongooseRepository.js";
import { ProfileModel, IProfileDocument, IQuizProgressSubdoc } from "../models/ProfileModel.js";
import { ProfileEntity } from "../../../../domain/entities/Profile.js";
import { ResumeEntity } from "../../../../domain/entities/Resume.js";
import { IProfileRepository } from "../../../../domain/repositories/IProfileRepository.js";
import { ProfileMapper } from "../mappers/ProfileMapper.js";
import { ResumeMapper } from "../mappers/ResumeMapper.js";
import { ResumeModel } from "../models/ResumeModel.js";
import { isMongoReady } from "../../database.js";
import {
  buildProfileMatchIndex,
  extractBatchJobDemandIndex,
  rankAffectedProfilesForNewJobs,
  INCREMENTAL_MATCH_BUDGET,
  type JobForDemandIndexLike,
  type ProfileForIndexLike,
  type FindAffectedUsersResult,
} from "../../../../domain/services/jobs/incrementalMatching.js";

@injectable()
export class MongooseProfileRepository
  extends BaseMongooseRepository<IProfileDocument, ProfileEntity, string>
  implements IProfileRepository
{
  private inMemoryResumes: ResumeEntity[] = [];

  constructor() {
    super(ProfileModel);
  }

  protected toEntity(doc: unknown): ProfileEntity {
    const entity = ProfileMapper.toEntity(doc);
    if (!entity) {
      throw new Error("Failed to map document to ProfileEntity");
    }
    return entity;
  }

  protected toPersistence(entity: Partial<ProfileEntity>): Record<string, unknown> {
    return ProfileMapper.toPersistence(entity);
  }

  async findByUserId(userId: string): Promise<ProfileEntity | null> {
    const uid = userId.toString();
    if (isMongoReady()) {
      const doc = await this.model.findOne({ userId }).lean();
      return doc ? this.toEntity(doc as Record<string, unknown>) : null;
    }
    const raw = this.inMemoryStore.get(uid);
    return raw ? this.toEntity(raw) : null;
  }

  async upsertProfile(userId: string, profileData: Partial<ProfileEntity>): Promise<ProfileEntity> {
    const uid = userId.toString();
    const updateData: Record<string, unknown> = { ...profileData };
    if (Array.isArray(updateData.roles) && updateData.roles.length === 0) {
      delete updateData.roles;
    }

    if (isMongoReady()) {
      const existingDoc = await this.model
        .findOne({ userId })
        .select("skills roles preferences careerProfile")
        .lean();
      const mergedForIndex = { ...(existingDoc || {}), ...updateData };
      const { matchTokens, matchCountryCodes } = buildProfileMatchIndex(mergedForIndex);
      const updated = await this.model
        .findOneAndUpdate(
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
        )
        .lean();
      return this.toEntity(updated as Record<string, unknown>);
    }

    const existing = this.inMemoryStore.get(uid);
    const merged = { ...(existing || {}), ...updateData };
    const { matchTokens, matchCountryCodes } = buildProfileMatchIndex(merged);
    const updated: Record<string, unknown> = {
      _id: existing?._id || new mongoose.Types.ObjectId().toString(),
      id: existing?.id || new mongoose.Types.ObjectId().toString(),
      userId: uid,
      ...merged,
      matchTokens,
      matchCountryCodes,
      version: (typeof existing?.version === "number" ? existing.version : 0) + 1,
      updatedAt: new Date(),
    };
    this.inMemoryStore.set(uid, updated);
    return this.toEntity(updated);
  }

  async createResume(resumeData: Partial<ResumeEntity>): Promise<ResumeEntity> {
    const persistenceData = ResumeMapper.toPersistence(resumeData);
    if (isMongoReady()) {
      try {
        const created = await ResumeModel.create(persistenceData);
        const mapped = ResumeMapper.toEntity(
          created.toObject ? created.toObject() : (created as unknown as Record<string, unknown>),
        );
        if (!mapped) throw new Error("Failed to map created resume");
        return mapped;
      } catch (error: unknown) {
        const isDuplicate =
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code: number }).code === 11000;
        if (!isDuplicate || !resumeData.s3Key) throw error;
        const existing = await ResumeModel.findOne({
          userId: resumeData.userId,
          s3Key: resumeData.s3Key,
        }).lean();
        if (!existing) throw error;
        const mapped = ResumeMapper.toEntity(existing as Record<string, unknown>);
        if (!mapped) throw new Error("Failed to map existing resume");
        return mapped;
      }
    }

    const uid = String(resumeData.userId || "");
    const existing = this.inMemoryResumes.find(
      (r) => r.userId === uid && r.s3Key === resumeData.s3Key,
    );
    if (existing) return existing;

    const mockId = new mongoose.Types.ObjectId().toString();
    const newResume: ResumeEntity = {
      id: mockId,
      userId: uid,
      fileHash: resumeData.fileHash || "",
      originalFilename: resumeData.originalFilename || "",
      mimeType: resumeData.mimeType || "",
      s3Key: resumeData.s3Key || "",
      encryptedRawText: resumeData.encryptedRawText || {
        cipherText: "",
        iv: "",
        tag: "",
        keyVersion: "v1",
      },
      parsedFactsCount: resumeData.parsedFactsCount || 0,
      factsSummary: resumeData.factsSummary || {
        roles: 0,
        skills: 0,
        education: 0,
        totalFacts: 0,
      },
      isActive: Boolean(resumeData.isActive),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.inMemoryResumes.push(newResume);
    return newResume;
  }

  async findResumesByUserId(userId: string): Promise<ResumeEntity[]> {
    const uid = userId.toString();
    if (isMongoReady()) {
      const docs = await ResumeModel.find({ userId }).sort({ createdAt: -1 }).lean();
      return docs
        .map((doc) => ResumeMapper.toEntity(doc as Record<string, unknown>))
        .filter((r): r is ResumeEntity => r !== null);
    }
    return this.inMemoryResumes.filter((r) => r.userId === uid);
  }

  async findResumeByIdAndUserId(resumeId: string, userId: string): Promise<ResumeEntity | null> {
    if (isMongoReady()) {
      const doc = await ResumeModel.findOne({ _id: resumeId, userId }).lean();
      return doc ? ResumeMapper.toEntity(doc as Record<string, unknown>) : null;
    }
    return this.inMemoryResumes.find((r) => r.id === resumeId && r.userId === userId) || null;
  }

  async findResumeByS3KeyAndUserId(s3Key: string, userId: string): Promise<ResumeEntity | null> {
    if (isMongoReady()) {
      const doc = await ResumeModel.findOne({ s3Key, userId }).lean();
      return doc ? ResumeMapper.toEntity(doc as Record<string, unknown>) : null;
    }
    return this.inMemoryResumes.find((r) => r.s3Key === s3Key && r.userId === userId) || null;
  }

  async setActiveResume(resumeId: string, userId: string): Promise<ResumeEntity | null> {
    if (isMongoReady()) {
      await ResumeModel.updateMany({ userId }, { $set: { isActive: false } });
      const doc = await ResumeModel.findOneAndUpdate(
        { _id: resumeId, userId },
        { $set: { isActive: true } },
        { new: true },
      ).lean();
      return doc ? ResumeMapper.toEntity(doc as Record<string, unknown>) : null;
    }
    for (const r of this.inMemoryResumes) {
      r.isActive = r.id === resumeId && r.userId === userId;
    }
    return this.inMemoryResumes.find((r) => r.id === resumeId && r.userId === userId) || null;
  }

  async findActiveResumeByUserId(userId: string): Promise<ResumeEntity | null> {
    if (isMongoReady()) {
      const doc = await ResumeModel.findOne({ userId, isActive: true }).lean();
      if (doc) return ResumeMapper.toEntity(doc as Record<string, unknown>);
      const fallback = await ResumeModel.findOne({ userId }).sort({ createdAt: -1 }).lean();
      return fallback ? ResumeMapper.toEntity(fallback as Record<string, unknown>) : null;
    }
    const active = this.inMemoryResumes.find((r) => r.userId === userId && r.isActive);
    if (active) return active;
    return this.inMemoryResumes.find((r) => r.userId === userId) || null;
  }
}

export interface ProfileRecord {
  _id?: string | mongoose.Types.ObjectId;
  userId: string | mongoose.Types.ObjectId;
  roles?: unknown[];
  skills?: string[];
  preferences?: Record<string, unknown>;
  careerProfile?: Record<string, unknown>;
  quizProgress?: IQuizProgressSubdoc;
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
  parsedFactsCount?: number;
  factsSummary?: { skills?: number; roles?: number; education?: number; totalFacts?: number };
  isActive?: boolean;
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
      return (await ProfileModel.findOne({ userId }).lean()) as unknown as ProfileRecord | null;
    }
    return inMemoryProfiles.get(uid) || null;
  },

  async upsertProfile(
    userId: string | mongoose.Types.ObjectId,
    profileData: Partial<ProfileRecord>,
  ): Promise<ProfileRecord> {
    const uid = userId.toString();
    const updateData: Partial<ProfileRecord> = { ...profileData };
    if (Array.isArray(updateData.roles) && updateData.roles.length === 0) delete updateData.roles;
    if (isMongoReady()) {
      const existingDoc = (await ProfileModel.findOne({ userId })
        .select("skills roles preferences careerProfile")
        .lean()) as unknown as Partial<ProfileRecord> | null;
      const mergedForIndex = { ...(existingDoc || {}), ...updateData };
      const { matchTokens, matchCountryCodes } = buildProfileMatchIndex(mergedForIndex);
      return (await ProfileModel.findOneAndUpdate(
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

  async createResume(
    resumeData: Partial<ResumeRecord> & { userId: string | mongoose.Types.ObjectId },
  ): Promise<ResumeRecord> {
    if (isMongoReady()) {
      try {
        const resume = new ResumeModel(resumeData);
        return (await resume.save()).toObject() as unknown as ResumeRecord;
      } catch (error: unknown) {
        const mongoError = error as { code?: number };
        if (mongoError?.code !== 11000 || !resumeData.s3Key) throw error;
        const existing = (await ResumeModel.findOne({
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
      return (await ResumeModel.find({ userId })
        .sort({ createdAt: -1 })
        .lean()) as unknown as ResumeRecord[];
    }
    return inMemoryResumes.filter((r) => r.userId.toString() === uid);
  },

  async findResumeByIdAndUserId(
    resumeId: string | mongoose.Types.ObjectId,
    userId: string | mongoose.Types.ObjectId,
  ): Promise<ResumeRecord | null> {
    if (isMongoReady()) {
      return (await ResumeModel.findOne({
        _id: resumeId,
        userId,
      }).lean()) as unknown as ResumeRecord | null;
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
      return (await ResumeModel.findOne({
        s3Key,
        userId,
      }).lean()) as unknown as ResumeRecord | null;
    }
    return (
      inMemoryResumes.find(
        (resume) => resume.s3Key === s3Key && resume.userId.toString() === userId.toString(),
      ) || null
    );
  },

  async setActiveResume(
    resumeId: string | mongoose.Types.ObjectId,
    userId: string | mongoose.Types.ObjectId,
  ): Promise<ResumeRecord | null> {
    const uid = userId.toString();
    if (isMongoReady()) {
      await ResumeModel.updateMany({ userId }, { $set: { isActive: false } });
      const doc = await ResumeModel.findOneAndUpdate(
        { _id: resumeId, userId },
        { $set: { isActive: true } },
        { new: true },
      ).lean();
      return doc as unknown as ResumeRecord | null;
    }
    for (const r of inMemoryResumes) {
      r.isActive = r._id?.toString() === resumeId.toString() && r.userId.toString() === uid;
    }
    return (
      inMemoryResumes.find(
        (r) => r._id?.toString() === resumeId.toString() && r.userId.toString() === uid,
      ) || null
    );
  },

  async findActiveResumeByUserId(
    userId: string | mongoose.Types.ObjectId,
  ): Promise<ResumeRecord | null> {
    const uid = userId.toString();
    if (isMongoReady()) {
      const doc = await ResumeModel.findOne({ userId, isActive: true }).lean();
      if (doc) return doc as unknown as ResumeRecord;
      const fallback = await ResumeModel.findOne({ userId }).sort({ createdAt: -1 }).lean();
      return fallback as unknown as ResumeRecord | null;
    }
    const active = inMemoryResumes.find((r) => r.userId.toString() === uid && r.isActive);
    if (active) return active;
    return inMemoryResumes.find((r) => r.userId.toString() === uid) || null;
  },
};

export async function findAffectedUsersForNewJobs(
  newJobs: JobForDemandIndexLike[] = [],
  { maxUsers = INCREMENTAL_MATCH_BUDGET.maxUsersPerRun }: { maxUsers?: number } = {},
): Promise<FindAffectedUsersResult> {
  const batchIndex = extractBatchJobDemandIndex(newJobs);
  if (!batchIndex.tokens.length || !isMongoReady()) {
    return {
      affectedUsers: [],
      candidateCount: 0,
      budgetMaxUsers: maxUsers,
      batchTokens: batchIndex.tokens,
    };
  }
  const safeMax = Math.max(1, Number(maxUsers) || INCREMENTAL_MATCH_BUDGET.maxUsersPerRun);
  const fetchCap = Math.min(1000, safeMax * 3);
  const query = {
    matchTokens: { $in: batchIndex.tokens },
  };
  const candidates = (await ProfileModel.find(query)
    .sort({ updatedAt: -1 })
    .limit(fetchCap)
    .select("userId version updatedAt matchTokens matchCountryCodes")
    .lean()) as unknown as ProfileForIndexLike[];

  const affectedUsers = rankAffectedProfilesForNewJobs(candidates, batchIndex, {
    maxUsers: safeMax,
  });

  return {
    affectedUsers,
    candidateCount: candidates.length,
    budgetMaxUsers: safeMax,
    batchTokens: batchIndex.tokens,
  };
}
