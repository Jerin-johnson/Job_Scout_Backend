import { Memory } from "../../infrastructure/database/mongoose/models/MemoryModel.js";
import { User } from "../../infrastructure/database/mongoose/models/UserModel.js";
import { isMongoReady } from "../../config/database.js";
import { embeddingService, cosineSimilarity } from "../../services/embeddingService.js";
import { get, set, bumpVersion, getVersion, CacheKeys, TTL } from "../../shared/cache.js";
import { PLAN_CONFIG, PLANS } from "../../shared/constants/plans.js";
import { logger } from "../../shared/utils/logger.js";
import { userRepository } from "../../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";

export const MEMORY_CONSENT_VERSION = "memory-consent-v1";

const PROTECTED_PATTERNS: RegExp[] = [
  /\b(christian|muslim|hindu|jewish|sikh|buddhist|atheist|religion)\b/i,
  /\b(caucasian|black|african|hispanic|latino|asian|ethnicity|race)\b/i,
  /\b(brahmin|dalit|caste|kshatriya|vaishya)\b/i,
  /\b(pregnant|disability|disease|medical condition|diagnosed with|health condition|surgery)\b/i,
  /\b(democrat|republican|bjp|congress|political party|voted for|politics|communist|socialist)\b/i,
  /\b(password|api[_ -]?key|secret[_ -]?key|private[_ -]?key|ssn|social security|aadhaar|pan card|credit card)\b/i,
  /\b(born in 19[0-9]{2}|age is [0-9]{2}|years old)\b/i,
];

export interface MemoryRecord {
  _id: unknown;
  userId: string;
  type?: string;
  key?: string;
  content: string;
  embedding?: number[];
  embeddingMetadata?: {
    provider?: string;
    model?: string;
    dimension?: number;
    [key: string]: unknown;
  };
  importance: number;
  confidence: number;
  source?: string;
  consentVersion?: string;
  useCount?: number;
  lastUsedAt?: Date;
  createdAt?: Date;
  isDeleted?: boolean;
  [key: string]: unknown;
}

const inMemoryStore: MemoryRecord[] = [];

export interface UserConsentLike {
  memoryConsent?: {
    version?: string | null;
    acceptedAt?: Date | string | null;
  } | null;
  memoryPaused?: boolean;
  [key: string]: unknown;
}

export function hasMemoryConsent(user?: UserConsentLike | null): boolean {
  if (!user) return false;
  return Boolean(
    user.memoryConsent?.version === MEMORY_CONSENT_VERSION && user.memoryConsent?.acceptedAt,
  );
}

export function isSensitiveMemoryContent(key = "", content = ""): boolean {
  const fullText = `${key} ${content}`;
  return PROTECTED_PATTERNS.some((pattern) => pattern.test(fullText));
}

export interface ProfileCardLike {
  targetRoles?: string[];
  currentRole?: string;
  location?: string;
}

/**
 * Profile data wins over memory on conflict (e.g., target roles, location, remote preference, salary).
 */
export function resolveProfileMemoryConflicts<T extends { key?: string; content?: string }>(
  memories: T[] = [],
  profileCard: ProfileCardLike = {},
): T[] {
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

async function resolveUserConsentState(
  userId: string | unknown,
  userObj: UserConsentLike | null = null,
): Promise<{ consented: boolean; paused: boolean }> {
  const uid = String(userId || "");
  if (userObj && userObj.memoryConsent !== undefined) {
    return {
      consented: hasMemoryConsent(userObj),
      paused: Boolean(userObj.memoryPaused),
    };
  }
  const user = await userRepository.findById(uid).catch(() => null);
  if (!user && isMongoReady()) {
    const doc = await User.findById(uid)
      .select("memoryConsent memoryPaused")
      .lean()
      .catch(() => null);
    if (doc) {
      return {
        consented: hasMemoryConsent(doc as UserConsentLike),
        paused: Boolean(doc.memoryPaused),
      };
    }
  }
  if (!user) return { consented: false, paused: false };
  return {
    consented: hasMemoryConsent(user as UserConsentLike),
    paused: Boolean((user as UserConsentLike).memoryPaused),
  };
}

export interface WriteMemoryOptions {
  userId: string | unknown;
  user?: UserConsentLike | null;
  userPlan?: string;
  type?: string;
  key?: string;
  content: string;
  importance?: number;
  confidence?: number;
  source?: string;
  requireConsent?: boolean;
}

export interface RetrieveRelevantOptions {
  userId: string | unknown;
  user?: UserConsentLike | null;
  queryText?: string;
  limit?: number;
  requireConsent?: boolean;
  profileCard?: ProfileCardLike | null;
}

export const longTermMemory = {
  MEMORY_CONSENT_VERSION,

  async checkConsent(
    userId: string | unknown,
    user: UserConsentLike | null = null,
  ): Promise<{ consented: boolean; paused: boolean }> {
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
  }: WriteMemoryOptions): Promise<MemoryRecord | null> {
    const uid = String(userId || "");
    // 0. Check pause & consent when required or when user is provided
    const state = await resolveUserConsentState(uid, user);
    if (state.paused) {
      logger.debug({ key }, "Memory discarded: user has paused memory capture");
      return null;
    }
    if (requireConsent && !state.consented) {
      const err = new Error("Memory consent is required before saving preferences.") as Error & {
        code?: string;
        statusCode?: number;
      };
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
      const err = new Error(
        "Compliance violation: Protected attributes cannot be retained",
      ) as Error & { code?: string; statusCode?: number };
      err.code = "PROTECTED_ATTRIBUTE_REJECTED";
      err.statusCode = 400;
      throw err;
    }

    // 3. Generate vector embedding
    const embeddingClient = embeddingService as unknown as {
      getEmbeddingWithMetadata: (
        text: string,
        opts?: { user?: unknown; feature?: string; requestId?: string },
      ) => Promise<{
        vector: number[];
        metadata: { provider?: string; model?: string; dimension?: number; [key: string]: unknown };
      }>;
    };
    const { vector: embedding, metadata: embeddingMetadata } =
      await embeddingClient.getEmbeddingWithMetadata(content, {
        user: { _id: uid, plan: userPlan },
        feature: "chat",
      });

    // 4. Check for near-duplicates (> 0.9 cosine similarity) or exact key match for preferences/goals
    const existingMemories = await this.listUserMemories(uid);
    let duplicate: MemoryRecord | null = null;

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

    let savedMemory: MemoryRecord;

    if (duplicate) {
      // Update existing memory rather than inserting duplicate
      if (isMongoReady()) {
        savedMemory = (await Memory.findByIdAndUpdate(
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
        ).lean()) as unknown as MemoryRecord;
      } else {
        duplicate.content = content;
        duplicate.embedding = embedding;
        duplicate.embeddingMetadata = embeddingMetadata;
        duplicate.importance = Math.max(importance, duplicate.importance);
        duplicate.consentVersion = MEMORY_CONSENT_VERSION;
        duplicate.useCount = (duplicate.useCount || 0) + 1;
        duplicate.lastUsedAt = new Date();
        savedMemory = duplicate;
      }
    } else {
      // 5. Enforce plan capacity caps (Free: 50, Pro: 300, Premium: 1000)
      const planConfig =
        (PLAN_CONFIG as Record<string, { quotas?: { maxMemories?: number } }>)[userPlan] ||
        PLAN_CONFIG[PLANS.FREE];
      const maxMemories = planConfig.quotas?.maxMemories || 50;

      if (existingMemories.length >= maxMemories) {
        // Evict least important & oldest memory
        const sorted = [...existingMemories].sort(
          (a, b) =>
            a.importance * 0.6 +
            (new Date(a.lastUsedAt || a.createdAt || 0).getTime() / 1e12) * 0.4 -
            (b.importance * 0.6 +
              (new Date(b.lastUsedAt || b.createdAt || 0).getTime() / 1e12) * 0.4),
        );
        const victim = sorted[0];
        if (victim) {
          await this.deleteMemory(uid, victim._id);
        }
      }

      // Insert new memory
      if (isMongoReady()) {
        savedMemory = (await Memory.create({
          userId: uid,
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
        })) as unknown as MemoryRecord;
      } else {
        savedMemory = {
          _id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          userId: uid,
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
    await bumpVersion(uid, "memory");
    return savedMemory;
  },

  /**
   * Retrieve top-K relevant memories reranked by similarity x importance x recency
   */
  async retrieveRelevant(
    first: RetrieveRelevantOptions | string | unknown,
    queryTextParam?: string,
    limitParam?: number,
    optsParam?: {
      user?: UserConsentLike | null;
      profileCard?: ProfileCardLike | null;
      requireConsent?: boolean;
    },
  ): Promise<MemoryRecord[]> {
    let userId: string | unknown;
    let user: UserConsentLike | null = null;
    let queryText: string | undefined;
    let limit = 5;
    let requireConsent = false;
    let profileCard: ProfileCardLike | null = null;

    if (
      typeof first === "object" &&
      first !== null &&
      ("userId" in first || "queryText" in first)
    ) {
      const opts = first as RetrieveRelevantOptions;
      userId = opts.userId;
      user = opts.user ?? null;
      queryText = opts.queryText;
      limit = opts.limit ?? 5;
      requireConsent = Boolean(opts.requireConsent);
      profileCard = opts.profileCard ?? null;
    } else {
      userId = first;
      queryText = queryTextParam;
      limit = limitParam ?? 5;
      user = optsParam?.user ?? null;
      profileCard = optsParam?.profileCard ?? null;
      requireConsent = Boolean(optsParam?.requireConsent);
    }

    const uid = String(userId || "");
    if (requireConsent || user) {
      const state = await resolveUserConsentState(uid, user);
      if (state.paused || (requireConsent && !state.consented)) return [];
    }
    let memories = await this.listUserMemories(uid);
    if (!memories || memories.length === 0) return [];
    if (profileCard) {
      memories = resolveProfileMemoryConflicts(memories, profileCard);
    }

    const embeddingClient = embeddingService as unknown as {
      getEmbeddingWithMetadata: (
        text: string,
        opts?: { user?: unknown; feature?: string; requestId?: string },
      ) => Promise<{
        vector: number[];
        metadata: { provider?: string; model?: string; dimension?: number; [key: string]: unknown };
      }>;
    };
    const { vector: queryEmbedding, metadata: queryMetadata } =
      await embeddingClient.getEmbeddingWithMetadata(queryText || "general preferences", {
        user: { _id: uid, plan: PLANS.FREE },
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
      const ageHours =
        (now - new Date(m.lastUsedAt || m.createdAt || now).getTime()) / (1000 * 3600);
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
  async updateMemory(
    userId: string | unknown,
    memoryId: string | unknown,
    updates: { key?: string; content?: string; importance?: number; type?: string } = {},
  ): Promise<MemoryRecord | null> {
    const uid = String(userId || "");
    const mid = String(memoryId || "");
    const nextKey = updates.key?.trim();
    const nextContent = updates.content?.trim();
    if (isSensitiveMemoryContent(nextKey || "", nextContent || "")) {
      const err = new Error(
        "Compliance violation: Protected attributes cannot be retained",
      ) as Error & { code?: string; statusCode?: number };
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
      return existing.toObject() as unknown as MemoryRecord;
    }

    const item = inMemoryStore.find(
      (m) => String(m._id) === mid && m.userId === uid && !m.isDeleted,
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
  async getPinnedBlock(userId: string | unknown): Promise<string> {
    const uid = String(userId || "");
    const ver = await getVersion(uid, "memory");
    const cacheKey = CacheKeys.pinnedMemory(uid, ver);

    const cached = await get<string>(cacheKey);
    if (cached) return cached;

    const memories = await this.listUserMemories(uid);
    const preferences = memories.filter((m) => m.type === "preference" || m.type === "goal");
    const formatted = preferences.map((p) => `- ${p.key}: ${p.content}`).join("\n");

    await set(cacheKey, formatted, TTL.PINNED_MEMORY);
    return formatted;
  },

  async listUserMemories(userId: string | unknown): Promise<MemoryRecord[]> {
    const uid = String(userId || "");
    if (isMongoReady()) {
      return (await Memory.find({ userId: uid, isDeleted: false })
        .sort({ lastUsedAt: -1, createdAt: -1 })
        .lean()) as unknown as MemoryRecord[];
    }
    return inMemoryStore.filter((m) => m.userId === uid && !m.isDeleted);
  },

  async deleteMemory(userId: string | unknown, memoryId: string | unknown): Promise<boolean> {
    const uid = String(userId || "");
    const mid = String(memoryId || "");

    if (isMongoReady()) {
      const res = await Memory.updateOne(
        { _id: mid, userId: uid, isDeleted: false },
        { $set: { isDeleted: true } },
      );
      await bumpVersion(uid, "memory");
      return res.modifiedCount > 0;
    }
    const idx = inMemoryStore.findIndex(
      (m) => String(m._id) === mid && m.userId === uid && !m.isDeleted,
    );
    if (idx !== -1) {
      inMemoryStore[idx].isDeleted = true;
      await bumpVersion(uid, "memory");
      return true;
    }
    return false;
  },

  async forgetAll(userId: string | unknown): Promise<boolean> {
    const uid = String(userId || "");
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

  async forgetAllMemories(userId: string | unknown): Promise<boolean> {
    return this.forgetAll(userId);
  },

  hasMemoryConsent,
  isSensitiveMemoryContent,
  resolveProfileMemoryConflicts,
};
