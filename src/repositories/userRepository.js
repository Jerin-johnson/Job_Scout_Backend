import mongoose from "mongoose";
import { User } from "../models/User.js";
import { isMongoReady } from "../config/database.js";
import { PLANS, ROLES } from "../shared/constants/plans.js";

// In-memory fallback repository for offline/smoke test environments
const inMemoryUsers = new Map();

export const userRepository = {
  async findByEmail(email) {
    const normalized = email.toLowerCase().trim();
    if (isMongoReady()) {
      return User.findOne({ email: normalized, isDeleted: false }).lean();
    }
    return inMemoryUsers.get(normalized) || null;
  },

  async findById(id) {
    if (isMongoReady()) {
      return User.findOne({ _id: id, isDeleted: false }).lean();
    }
    for (const u of inMemoryUsers.values()) {
      if (u._id.toString() === id.toString() && !u.isDeleted) return u;
    }
    return null;
  },

  async create(userData) {
    const normalized = userData.email.toLowerCase().trim();
    if (isMongoReady()) {
      const user = new User({
        ...userData,
        email: normalized,
      });
      return (await user.save()).toObject();
    }

    const mockId = new mongoose.Types.ObjectId().toString();
    const newUser = {
      _id: mockId,
      email: normalized,
      passwordHash: userData.passwordHash || null,
      googleId: userData.googleId || null,
      name: userData.name || "",
      role: userData.role || ROLES.USER,
      plan: userData.plan || PLANS.FREE,
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

  async update(id, updates) {
    if (isMongoReady()) {
      return User.findByIdAndUpdate(id, { $set: updates }, { new: true }).lean();
    }
    for (const [email, u] of inMemoryUsers.entries()) {
      if (u._id.toString() === id.toString()) {
        const updated = { ...u, ...updates, updatedAt: new Date() };
        inMemoryUsers.set(email, updated);
        return updated;
      }
    }
    return null;
  },

  async recordFailedLogin(id, currentAttempts) {
    const attempts = currentAttempts + 1;
    const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
    return this.update(id, { failedLoginAttempts: attempts, lockUntil });
  },

  async resetFailedLogins(id) {
    return this.update(id, { failedLoginAttempts: 0, lockUntil: null });
  },

  async addRefreshToken(id, tokenMeta) {
    if (isMongoReady()) {
      return User.findByIdAndUpdate(
        id,
        {
          $push: {
            refreshTokens: {
              $each: [tokenMeta],
              $slice: -10, // keep at most 10 active tokens
            },
          },
        },
        { new: true },
      ).lean();
    }
    const u = await this.findById(id);
    if (u) {
      const tokens = (u.refreshTokens || []).concat(tokenMeta).slice(-10);
      return this.update(id, { refreshTokens: tokens });
    }
    return null;
  },

  async revokeTokenFamily(id, familyId) {
    if (isMongoReady()) {
      return User.findByIdAndUpdate(
        id,
        { $pull: { refreshTokens: { familyId } } },
        { new: true },
      ).lean();
    }
    const u = await this.findById(id);
    if (u) {
      const filtered = (u.refreshTokens || []).filter((t) => t.familyId !== familyId);
      return this.update(id, { refreshTokens: filtered });
    }
    return null;
  },
};
