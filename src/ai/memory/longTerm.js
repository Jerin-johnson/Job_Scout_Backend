import { Memory } from "../../models/Memory.js";
import { User } from "../../models/User.js";
import { isMongoReady } from "../../config/database.js";
import { embeddingService, cosineSimilarity } from "../../services/embeddingService.js";
import { get, set, bumpVersion, getVersion, CacheKeys, TTL } from "../../shared/cache.js";
import { PLAN_CONFIG, PLANS } from "../../shared/constants/plans.js";
import { logger } from "../../shared/utils/logger.js";
import { userRepository } from "../../repositories/userRepository.js";

export const MEMORY_CONSENT_VERSION = "memory-consent-v1";

const PROTECTED_PATTERNS = [
  /\b(christian|muslim|hindu|jewish|sikh|buddhist|atheist|religion)\b/i,
  /\b(caucasian|black|african|hispanic|latino|asian|ethnicity|race)\b/i,
  /\b(brahmin|dalit|caste|kshatriya|vaishya)\b/i,
  /\b(pregnant|disability|disease|medical condition|diagnosed with|health condition|surgery)\b/i,
  /\b(democrat|republican|bjp|congress|political party|voted for|politics|communist|socialist)\b/i,
  /\b(password|api[_ -]?key|secret[_ -]?key|private[_ -]?key|ssn|social security|aadhaar|pan card|credit card)\b/i,
  /\b(born in 19[0-9]{2}|age is [0-9]{2}|years old)\b/i,
];

const inMemoryStore = [];

export function hasMemoryConsent(user) {
  if (!user) return false;
  return Boolean(
    user.memoryConsent?.version === MEMORY_CONSENT_VERSION && user.memoryConsent?.acceptedAt,
  );
}

export function isSensitiveMemoryContent(key = "", content = "") {
  const fullText = `${key} ${content}`;
  return PROTECTED_PATTERNS.some((pattern) => pattern.test(fullText));
}

/**
 * Profile data wins over memory on conflict (e.g., target roles, location, remote preference, salary).
 */
export function resolveProfileMemoryConflicts(memories = [], profileCard = {}) {
  if (!Array.isArray(memories) || !memories.length) return [];
  const hasProfileRole = Boolean(profileCard?.targetRoles?.length || profileCard?.currentRole);
  const hasProfileLocation = Boolean(profileCard?.location);
  return memories.filter((memory) => {
    const key = String(memory.key || "").toLowerCase();
    const content = String(memory.content || "").toLowerCase();
    if (
      hasProfileRole &&
      /\b(target[_\s-]?role|current[_\s-]?role|desired[_\s-]?role)\b/.test(key)
    ) {
      const profileRoles = [...(profileCard.targetRoles || []), profileCard.currentRole || ""]
        .join(" ")
        .toLowerCase();
      if (profileRoles && !profileRoles.includes(content) && !content.includes(profileRoles)) {
        return false;
      }
    }
    if (hasProfileLocation && /\b(preferred[_\s-]?location|location|city|country)\b/.test(key)) {
      const loc = String(profileCard.location || "").toLowerCase();
      if (loc && !loc.includes(content) && !content.includes(loc)) {
        return false;
      }
    }
    return true;
  });
}

async function resolveUserConsentState(userId, userObj = null) {
  if (userObj && userObj.memoryConsent !== undefined) {
    return {
      consented: hasMemoryConsent(userObj),
      paused: Boolean(userObj.memoryPaused),
    };
  }
  const user = await userRepository.findById(userId).catch(() => null);
  if (!user && isMongoReady()) {
    const doc = await User.findById(userId)
      .select("memoryConsent memoryPaused")
      .lean()
      .catch(() => null);
    if (doc) {
      return {
        consented: hasMemoryConsent(doc),
        paused: Boolean(doc.memoryPaused),
      };
    }
  }
  if (!user) return { consented: false, paused: false };
  return {
    consented: hasMemoryConsent(user),
    paused: Boolean(user.memoryPaused),
  };
}

export const longTermMemory = {
  MEMORY_CONSENT_VERSION,

  async checkConsent(userId, user = null) {
    return resolveUserConsentState(userId, user);
  },

  /**
   * Write or update memory item with deduplication (> 0.9 similarity), consent & pause checks, and compliance filtering
   */
  async writeMemory({
    userId,
    user = null,
    userPlan = PLANS.FREE,
    type,
    key,
    content,
    importance = 3,
    confidence = 0.8,
    source = "chat",
    requireConsent = false,
  }) {
    // 0. Check pause & consent when required or when user is provided
    const state = await resolveUserConsentState(userId, user);
    if (state.paused) {
      logger.debug({ key }, "Memory discarded: user has paused memory capture");
      return null;
    }
    if (requireConsent && !state.consented) {
      const err = new Error("Memory consent is required before saving preferences.");
      err.code = "MEMORY_CONSENT_REQUIRED";
      err.statusCode = 403;
      throw err;
    }

    // 1. Minimum confidence threshold (0.7)
    if (confidence < 0.7) {
      logger.debug({ key, confidence }, "Memory discarded: below 0.7 confidence threshold");
      return null;
    }

    // 2. Compliance Defense: Filter protected attributes and secrets
    if (isSensitiveMemoryContent(key, content)) {
      logger.warn({ key }, "Memory rejected by compliance filter: protected attribute detected");
      const err = new Error("Compliance violation: Protected attributes cannot be retained");
      err.code = "PROTECTED_ATTRIBUTE_REJECTED";
      err.statusCode = 400;
      throw err;
    }

    // 3. Generate vector embedding
    const { vector: embedding, metadata: embeddingMetadata } =
      await embeddingService.getEmbeddingWithMetadata(content, {
        user: { _id: userId, plan: userPlan },
        feature: "chat",
      });

    // 4. Check for near-duplicates (> 0.9 cosine similarity) or exact key match for preferences/goals
    const existingMemories = await this.listUserMemories(userId);
    let duplicate = null;

    for (const m of existingMemories) {
      if ((type === "preference" || type === "goal") && m.key === key && m.type === type) {
        duplicate = m;
        break;
      }
      if (
        m.type === type &&
        m.embedding &&
        m.embedding.length > 0 &&
        m.embeddingMetadata?.provider === embeddingMetadata.provider &&
        m.embeddingMetadata?.model === embeddingMetadata.model &&
        m.embeddingMetadata?.dimension === embeddingMetadata.dimension
      ) {
        const sim = cosineSimilarity(embedding, m.embedding);
        if (sim >= 0.9) {
          duplicate = m;
          break;
        }
      }
    }

    let savedMemory;

    if (duplicate) {
      // Update existing memory rather than inserting duplicate
      if (isMongoReady()) {
        savedMemory = await Memory.findByIdAndUpdate(
          duplicate._id,
          {
            $set: {
              content,
              embedding,
              embeddingMetadata,
              importance: Math.max(importance, duplicate.importance),
              confidence,
              consentVersion: MEMORY_CONSENT_VERSION,
              lastUsedAt: new Date(),
            },
            $inc: { useCount: 1 },
          },
          { new: true },
        ).lean();
      } else {
        duplicate.content = content;
        duplicate.embedding = embedding;
        duplicate.embeddingMetadata = embeddingMetadata;
        duplicate.importance = Math.max(importance, duplicate.importance);
        duplicate.consentVersion = MEMORY_CONSENT_VERSION;
        duplicate.useCount++;
        duplicate.lastUsedAt = new Date();
        savedMemory = duplicate;
      }
    } else {
      // 5. Enforce plan capacity caps (Free: 50, Pro: 300, Premium: 1000)
      const planConfig = PLAN_CONFIG[userPlan] || PLAN_CONFIG[PLANS.FREE];
      const maxMemories = planConfig.quotas.maxMemories || 50;

      if (existingMemories.length >= maxMemories) {
        // Evict least important & oldest memory
        const sorted = [...existingMemories].sort(
          (a, b) =>
            a.importance * 0.6 +
            (new Date(a.lastUsedAt).getTime() / 1e12) * 0.4 -
            (b.importance * 0.6 + (new Date(b.lastUsedAt).getTime() / 1e12) * 0.4),
        );
        const victim = sorted[0];
        if (victim) {
          await this.deleteMemory(userId, victim._id);
        }
      }

      // Insert new memory
      if (isMongoReady()) {
        savedMemory = await Memory.create({
          userId,
          type,
          key,
          content,
          embedding,
          embeddingMetadata,
          importance,
          confidence,
          source,
          consentVersion: MEMORY_CONSENT_VERSION,
          lastUsedAt: new Date(),
        });
      } else {
        savedMemory = {
          _id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          userId: userId.toString(),
          type,
          key,
          content,
          embedding,
          embeddingMetadata,
          importance,
          confidence,
          source,
          consentVersion: MEMORY_CONSENT_VERSION,
          useCount: 0,
          lastUsedAt: new Date(),
          createdAt: new Date(),
          isDeleted: false,
        };
        inMemoryStore.push(savedMemory);
      }
    }

    // 6. Invalidate pinned cache by bumping memory version
    await bumpVersion(userId.toString(), "memory");
    return savedMemory;
  },

  /**
   * Retrieve top-K relevant memories reranked by similarity x importance x recency
   */
  async retrieveRelevant({
    userId,
    user = null,
    queryText,
    limit = 5,
    requireConsent = false,
    profileCard = null,
  }) {
    if (requireConsent || user) {
      const state = await resolveUserConsentState(userId, user);
      if (state.paused || (requireConsent && !state.consented)) return [];
    }
    let memories = await this.listUserMemories(userId);
    if (!memories || memories.length === 0) return [];
    if (profileCard) {
      memories = resolveProfileMemoryConflicts(memories, profileCard);
    }

    const { vector: queryEmbedding, metadata: queryMetadata } =
      await embeddingService.getEmbeddingWithMetadata(queryText || "general preferences", {
        user: { _id: userId, plan: PLANS.FREE },
        feature: "chat",
      });
    const now = Date.now();

    const scored = memories.map((m) => {
      const sameEmbeddingSpace =
        m.embeddingMetadata?.provider === queryMetadata.provider &&
        m.embeddingMetadata?.model === queryMetadata.model &&
        m.embeddingMetadata?.dimension === queryMetadata.dimension;
      const sim =
        sameEmbeddingSpace && m.embedding ? cosineSimilarity(queryEmbedding, m.embedding) : 0.5;
      const ageHours = (now - new Date(m.lastUsedAt || m.createdAt).getTime()) / (1000 * 3600);
      const recencyScore = Math.max(0.1, 1 / (1 + ageHours * 0.05)); // decay over time
      const finalScore = sim * 0.5 + (m.importance / 5) * 0.3 + recencyScore * 0.2;

      return {
        memory: m,
        score: finalScore,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.memory);
  },

  /**
   * Edit an existing user-owned memory item
   */
  async updateMemory(userId, memoryId, updates = {}) {
    const uid = userId.toString();
    const mid = memoryId.toString();
    const nextKey = updates.key?.trim();
    const nextContent = updates.content?.trim();
    if (isSensitiveMemoryContent(nextKey || "", nextContent || "")) {
      const err = new Error("Compliance violation: Protected attributes cannot be retained");
      err.code = "PROTECTED_ATTRIBUTE_REJECTED";
      err.statusCode = 400;
      throw err;
    }

    if (isMongoReady()) {
      const existing = await Memory.findOne({ _id: mid, userId: uid, isDeleted: false });
      if (!existing) return null;
      if (nextKey) existing.key = nextKey;
      if (nextContent) existing.content = nextContent;
      if (updates.importance !== undefined) existing.importance = updates.importance;
      if (updates.type) existing.type = updates.type;
      existing.source = "user_edit";
      existing.lastUsedAt = new Date();
      await existing.save();
      await bumpVersion(uid, "memory");
      return existing.toObject();
    }

    const item = inMemoryStore.find(
      (m) => m._id.toString() === mid && m.userId === uid && !m.isDeleted,
    );
    if (!item) return null;
    if (nextKey) item.key = nextKey;
    if (nextContent) item.content = nextContent;
    if (updates.importance !== undefined) item.importance = updates.importance;
    if (updates.type) item.type = updates.type;
    item.source = "user_edit";
    item.lastUsedAt = new Date();
    await bumpVersion(uid, "memory");
    return item;
  },

  /**
   * Get pinned memory block cached at mem:pinned:{userId}:{ver}
   */
  async getPinnedBlock(userId) {
    const uid = userId.toString();
    const ver = await getVersion(uid, "memory");
    const cacheKey = CacheKeys.pinnedMemory(uid, ver);

    const cached = await get(cacheKey);
    if (cached) return cached;

    const memories = await this.listUserMemories(uid);
    const preferences = memories.filter((m) => m.type === "preference" || m.type === "goal");
    const formatted = preferences.map((p) => `- ${p.key}: ${p.content}`).join("\n");

    await set(cacheKey, formatted, TTL.PINNED_MEMORY);
    return formatted;
  },

  async listUserMemories(userId) {
    const uid = userId.toString();
    if (isMongoReady()) {
      return Memory.find({ userId: uid, isDeleted: false })
        .sort({ lastUsedAt: -1, createdAt: -1 })
        .lean();
    }
    return inMemoryStore.filter((m) => m.userId === uid && !m.isDeleted);
  },

  async deleteMemory(userId, memoryId) {
    const uid = userId.toString();
    const mid = memoryId.toString();

    if (isMongoReady()) {
      const res = await Memory.updateOne(
        { _id: mid, userId: uid, isDeleted: false },
        { $set: { isDeleted: true } },
      );
      await bumpVersion(uid, "memory");
      return res.modifiedCount > 0;
    }
    const idx = inMemoryStore.findIndex(
      (m) => m._id.toString() === mid && m.userId === uid && !m.isDeleted,
    );
    if (idx !== -1) {
      inMemoryStore[idx].isDeleted = true;
      await bumpVersion(uid, "memory");
      return true;
    }
    return false;
  },

  async forgetAll(userId) {
    const uid = userId.toString();
    if (isMongoReady()) {
      await Memory.updateMany({ userId: uid }, { $set: { isDeleted: true } });
    } else {
      for (const m of inMemoryStore) {
        if (m.userId === uid) m.isDeleted = true;
      }
    }
    await bumpVersion(uid, "memory");
    return true;
  },

  async forgetAllMemories(userId) {
    return this.forgetAll(userId);
  },

  hasMemoryConsent,
  isSensitiveMemoryContent,
  resolveProfileMemoryConflicts,
};
