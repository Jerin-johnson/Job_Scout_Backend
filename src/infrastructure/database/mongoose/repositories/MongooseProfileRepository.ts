import { injectable } from "tsyringe";
import mongoose from "mongoose";
import { BaseMongooseRepository } from "./BaseMongooseRepository.js";
import { ProfileModel, IProfileDocument } from "../models/ProfileModel.js";
import { ProfileEntity } from "../../../../domain/entities/Profile.js";
import { ResumeEntity } from "../../../../domain/entities/Resume.js";
import { IProfileRepository } from "../../../../domain/repositories/IProfileRepository.js";
import { ProfileMapper } from "../mappers/ProfileMapper.js";
import { ResumeMapper } from "../mappers/ResumeMapper.js";
import { ResumeModel } from "../models/ResumeModel.js";
import { isMongoReady } from "../../../../config/database.js";
import { buildProfileMatchIndex } from "../../../../services/jobs/incrementalMatching.js";

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
      const updated = await this.model.findOneAndUpdate(
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
        const mapped = ResumeMapper.toEntity(created.toObject ? created.toObject() : (created as unknown as Record<string, unknown>));
        if (!mapped) throw new Error("Failed to map created resume");
        return mapped;
      } catch (error: unknown) {
        const isDuplicate = error && typeof error === "object" && "code" in error && (error as { code: number }).code === 11000;
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
    return (
      this.inMemoryResumes.find(
        (r) => r.id === resumeId && r.userId === userId,
      ) || null
    );
  }

  async findResumeByS3KeyAndUserId(s3Key: string, userId: string): Promise<ResumeEntity | null> {
    if (isMongoReady()) {
      const doc = await ResumeModel.findOne({ s3Key, userId }).lean();
      return doc ? ResumeMapper.toEntity(doc as Record<string, unknown>) : null;
    }
    return (
      this.inMemoryResumes.find(
        (r) => r.s3Key === s3Key && r.userId === userId,
      ) || null
    );
  }
}
