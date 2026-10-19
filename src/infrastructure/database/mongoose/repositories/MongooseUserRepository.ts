import { injectable } from "tsyringe";
import mongoose from "mongoose";
import { BaseMongooseRepository } from "./BaseMongooseRepository.js";
import { UserModel, IUserDocument } from "../models/UserModel.js";
import { UserEntity, IRefreshTokenMeta } from "../../../../domain/entities/User.js";
import { IUserRepository } from "../../../../domain/repositories/IUserRepository.js";
import { UserMapper } from "../mappers/UserMapper.js";
import { isMongoReady } from "../../../../config/database.js";
import { PLANS, ROLES } from "../../../../shared/constants/plans.js";

@injectable()
export class MongooseUserRepository
  extends BaseMongooseRepository<IUserDocument, UserEntity, string>
  implements IUserRepository
{
  constructor() {
    super(UserModel);
  }

  protected toEntity(doc: unknown): UserEntity {
    const entity = UserMapper.toEntity(doc);
    if (!entity) {
      throw new Error("Failed to map document to UserEntity");
    }
    return entity;
  }

  protected toPersistence(entity: Partial<UserEntity>): Record<string, unknown> {
    return UserMapper.toPersistence(entity);
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    const normalized = email.toLowerCase().trim();
    if (isMongoReady()) {
      const doc = await this.model.findOne({ email: normalized, isDeleted: false }).lean();
      return doc ? this.toEntity(doc as Record<string, unknown>) : null;
    }
    for (const raw of this.inMemoryStore.values()) {
      if (raw.email === normalized && !raw.isDeleted) {
        return this.toEntity(raw);
      }
    }
    return null;
  }

  override async findById(id: string): Promise<UserEntity | null> {
    const idStr = String(id);
    if (isMongoReady()) {
      const doc = await this.model.findOne({ _id: idStr, isDeleted: false }).lean();
      return doc ? this.toEntity(doc as Record<string, unknown>) : null;
    }
    for (const raw of this.inMemoryStore.values()) {
      const storedId = String(raw._id || raw.id || "");
      if (storedId === idStr && !raw.isDeleted) {
        return this.toEntity(raw);
      }
    }
    return null;
  }

  override async create(userData: Partial<UserEntity>): Promise<UserEntity> {
    const normalized = (userData.email || "").toLowerCase().trim();
    if (isMongoReady()) {
      const user = new this.model({
        ...userData,
        email: normalized,
      });
      const saved = await user.save();
      return this.toEntity(saved.toObject());
    }

    const mockId = new mongoose.Types.ObjectId().toString();
    const newUser: Record<string, unknown> = {
      _id: mockId,
      id: mockId,
      email: normalized,
      passwordHash: userData.passwordHash || null,
      googleId: userData.googleId || null,
      name: userData.name || "",
      preferredName: userData.preferredName || "",
      role: userData.role || ROLES.USER,
      plan: userData.plan || PLANS.FREE,
      planSource: userData.planSource || "manual",
      planVersion: 1,
      profileVersion: 1,
      failedLoginAttempts: 0,
      lockUntil: null,
      refreshTokens: [],
      memoryPaused: false,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.inMemoryStore.set(mockId, newUser);
    return this.toEntity(newUser);
  }

  async bumpProfileVersion(id: string): Promise<UserEntity | null> {
    const idStr = String(id);
    if (isMongoReady()) {
      const doc = await this.model
        .findByIdAndUpdate(idStr, { $inc: { profileVersion: 1 } }, { new: true })
        .lean();
      return doc ? this.toEntity(doc as Record<string, unknown>) : null;
    }
    const current = await this.findById(idStr);
    return current
      ? this.update(idStr, { profileVersion: (current.profileVersion || 1) + 1 })
      : null;
  }

  async recordFailedLogin(id: string, currentAttempts: number): Promise<UserEntity | null> {
    const attempts = currentAttempts + 1;
    const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
    return this.update(id, { failedLoginAttempts: attempts, lockUntil });
  }

  async resetFailedLogins(id: string): Promise<UserEntity | null> {
    return this.update(id, { failedLoginAttempts: 0, lockUntil: null });
  }

  async addRefreshToken(id: string, tokenMeta: IRefreshTokenMeta): Promise<UserEntity | null> {
    const idStr = String(id);
    if (isMongoReady()) {
      const doc = await this.model
        .findByIdAndUpdate(
          idStr,
          {
            $push: {
              refreshTokens: {
                $each: [
                  {
                    tokenHash: tokenMeta.tokenHash,
                    familyId: tokenMeta.familyId,
                    expiresAt: tokenMeta.expiresAt,
                    isRevoked: false,
                  },
                ],
                $slice: -10,
              },
            },
          },
          { new: true },
        )
        .lean();
      return doc ? this.toEntity(doc as Record<string, unknown>) : null;
    }
    const current = await this.findById(idStr);
    if (current) {
      const tokens = (current.refreshTokens || []).concat(tokenMeta).slice(-10);
      return this.update(idStr, { refreshTokens: tokens });
    }
    return null;
  }

  async revokeTokenFamily(id: string, familyId: string): Promise<UserEntity | null> {
    const idStr = String(id);
    if (isMongoReady()) {
      const doc = await this.model
        .findByIdAndUpdate(idStr, { $pull: { refreshTokens: { familyId } } }, { new: true })
        .lean();
      return doc ? this.toEntity(doc as Record<string, unknown>) : null;
    }
    const current = await this.findById(idStr);
    if (current) {
      const filtered = (current.refreshTokens || []).filter((t) => t.familyId !== familyId);
      return this.update(idStr, { refreshTokens: filtered });
    }
    return null;
  }
}

export interface UserRecord {
  _id: string | mongoose.Types.ObjectId;
  email: string;
  passwordHash?: string | null;
  googleId?: string | null;
  name?: string;
  preferredName?: string;
  role: string;
  plan: string;
  planSource?: string;
  planVersion?: number;
  profileVersion?: number;
  failedLoginAttempts?: number;
  lockUntil?: Date | null;
  refreshTokens?: IRefreshTokenMeta[];
  memoryPaused?: boolean;
  isDeleted?: boolean;
  timezone?: string;
  mockInterviewTrialUsedAt?: Date | null;
  mockInterviewTrialSessionId?: string | null;
  mockInterviewQuotaDay?: string | null;
  mockInterviewQuotaCount?: number;
  mockInterviewQuotaSessionIds?: mongoose.Types.ObjectId[];
  createdAt?: Date;
  updatedAt?: Date;
  [key: string]: unknown;
}

const inMemoryUsers = new Map<string, UserRecord>();

export const userRepository = {
  async findByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.toLowerCase().trim();
    if (isMongoReady()) {
      return (await UserModel.findOne({
        email: normalized,
        isDeleted: false,
      }).lean()) as unknown as UserRecord | null;
    }
    return inMemoryUsers.get(normalized) || null;
  },

  async findById(id: string | mongoose.Types.ObjectId): Promise<UserRecord | null> {
    const idStr = id.toString();
    if (isMongoReady()) {
      return (await UserModel.findOne({
        _id: id,
        isDeleted: false,
      }).lean()) as unknown as UserRecord | null;
    }
    for (const u of inMemoryUsers.values()) {
      if (u._id.toString() === idStr && !u.isDeleted) return u;
    }
    return null;
  },

  async create(userData: Partial<UserRecord>): Promise<UserRecord> {
    const normalized = (userData.email || "").toLowerCase().trim();
    if (isMongoReady()) {
      const user = new UserModel({
        ...userData,
        email: normalized,
      });
      return (await user.save()).toObject() as unknown as UserRecord;
    }

    const mockId = new mongoose.Types.ObjectId().toString();
    const newUser: UserRecord = {
      _id: mockId,
      email: normalized,
      passwordHash: userData.passwordHash || null,
      googleId: userData.googleId || null,
      name: userData.name || "",
      preferredName: userData.preferredName || "",
      role: userData.role || ROLES.USER,
      plan: userData.plan || PLANS.FREE,
      planSource: userData.planSource || "manual",
      planVersion: 1,
      profileVersion: 1,
      failedLoginAttempts: 0,
      lockUntil: null,
      refreshTokens: [],
      memoryPaused: false,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    inMemoryUsers.set(normalized, newUser);
    return newUser;
  },

  async update(
    id: string | mongoose.Types.ObjectId,
    updates: Partial<UserRecord>,
  ): Promise<UserRecord | null> {
    const idStr = id.toString();
    if (isMongoReady()) {
      return (await UserModel.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true },
      ).lean()) as unknown as UserRecord | null;
    }
    for (const [email, u] of inMemoryUsers.entries()) {
      if (u._id.toString() === idStr) {
        const updated: UserRecord = { ...u, ...updates, updatedAt: new Date() };
        inMemoryUsers.set(email, updated);
        return updated;
      }
    }
    return null;
  },

  async bumpProfileVersion(id: string | mongoose.Types.ObjectId): Promise<UserRecord | null> {
    if (isMongoReady()) {
      return (await UserModel.findByIdAndUpdate(
        id,
        { $inc: { profileVersion: 1 } },
        { new: true },
      ).lean()) as unknown as UserRecord | null;
    }
    const current = await this.findById(id);
    return current ? this.update(id, { profileVersion: (current.profileVersion || 1) + 1 }) : null;
  },

  async recordFailedLogin(
    id: string | mongoose.Types.ObjectId,
    currentAttempts: number,
  ): Promise<UserRecord | null> {
    const attempts = currentAttempts + 1;
    const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
    return this.update(id, { failedLoginAttempts: attempts, lockUntil });
  },

  async resetFailedLogins(id: string | mongoose.Types.ObjectId): Promise<UserRecord | null> {
    return this.update(id, { failedLoginAttempts: 0, lockUntil: null });
  },

  async addRefreshToken(
    id: string | mongoose.Types.ObjectId,
    tokenMeta: IRefreshTokenMeta,
  ): Promise<UserRecord | null> {
    if (isMongoReady()) {
      return (await UserModel.findByIdAndUpdate(
        id,
        {
          $push: {
            refreshTokens: {
              $each: [tokenMeta],
              $slice: -10,
            },
          },
        },
        { new: true },
      ).lean()) as unknown as UserRecord | null;
    }
    const u = await this.findById(id);
    if (u) {
      const tokens = (u.refreshTokens || []).concat(tokenMeta).slice(-10);
      return this.update(id, { refreshTokens: tokens });
    }
    return null;
  },

  async revokeTokenFamily(
    id: string | mongoose.Types.ObjectId,
    familyId: string,
  ): Promise<UserRecord | null> {
    if (isMongoReady()) {
      return (await UserModel.findByIdAndUpdate(
        id,
        { $pull: { refreshTokens: { familyId } } },
        { new: true },
      ).lean()) as unknown as UserRecord | null;
    }
    const u = await this.findById(id);
    if (u) {
      const filtered = (u.refreshTokens || []).filter((t) => t.familyId !== familyId);
      return this.update(id, { refreshTokens: filtered });
    }
    return null;
  },
};
