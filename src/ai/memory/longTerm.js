import { Memory } from "../../models/Memory.js";
import { isMongoReady } from "../../config/database.js";
import { embeddingService, cosineSimilarity } from "../../services/embeddingService.js";
import { get, set, bumpVersion, getVersion, CacheKeys, TTL } from "../../shared/cache.js";
import { PLAN_CONFIG, PLANS } from "../../shared/constants/plans.js";
import { logger } from "../../shared/utils/logger.js";

const inMemoryStore = [];

export const longTermMemory = {
  /**
   * Write or update memory item with deduplication (> 0.9 similarity) and contradiction linking
   */
  async writeMemory({
    userId,
    userPlan = PLANS.FREE,
    type,
    key,
    content,
    importance = 3,
    confidence = 0.8,
    source = "chat",
  }) {
    // 1. Minimum confidence threshold (0.7)
    if (confidence < 0.7) {
      logger.debug({ key, confidence }, "Memory discarded: below 0.7 confidence threshold");
      return null;
    }

    // 2. Compliance Defense: Filter protected attributes
    const protectedPatterns = [
      /\b(christian|muslim|hindu|jewish|sikh|buddhist|atheist|religion)\b/i,
      /\b(caucasian|black|african|hispanic|latino|asian|ethnicity|race)\b/i,
      /\b(brahmin|dalit|caste|kshatriya|vaishya)\b/i,
      /\b(pregnant|disability|disease|medical condition|diagnosed with)\b/i,
      /\b(born in 19[0-9]{2}|age is [0-9]{2}|years old)\b/i,
    ];
    const fullText = `${key} ${content}`;
    for (const pattern of protectedPatterns) {
      if (pattern.test(fullText)) {
        logger.warn({ key }, "Memory rejected by compliance filter: protected attribute detected");
        const err = new Error("Compliance violation: Protected attributes cannot be retained");
        err.code = "PROTECTED_ATTRIBUTE_REJECTED";
        throw err;
      }
    }

    // 3. Generate vector embedding
    const { vector: embedding, metadata: embeddingMetadata } = await embeddingService.getEmbeddingWithMetadata(content, {
      user: { _id: userId, plan: userPlan },
      feature: "chat",
    });

    // 4. Check for near-duplicates (> 0.9 cosine similarity)
    const existingMemories = await this.listUserMemories(userId);
    let duplicate = null;

    for (const m of existingMemories) {
      if (m.type === type && m.embedding && m.embedding.length > 0 &&
          m.embeddingMetadata?.provider === embeddingMetadata.provider &&
          m.embeddingMetadata?.model === embeddingMetadata.model &&
          m.embeddingMetadata?.dimension === embeddingMetadata.dimension) {
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
  async retrieveRelevant({ userId, queryText, limit = 5 }) {
    const memories = await this.listUserMemories(userId);
    if (!memories || memories.length === 0) return [];

    const { vector: queryEmbedding, metadata: queryMetadata } = await embeddingService.getEmbeddingWithMetadata(queryText, {
      user: { _id: userId, plan: PLANS.FREE },
      feature: "chat",
    });
    const now = Date.now();

    const scored = memories.map((m) => {
      const sameEmbeddingSpace = m.embeddingMetadata?.provider === queryMetadata.provider &&
        m.embeddingMetadata?.model === queryMetadata.model &&
        m.embeddingMetadata?.dimension === queryMetadata.dimension;
      const sim = sameEmbeddingSpace && m.embedding
        ? cosineSimilarity(queryEmbedding, m.embedding)
        : 0.5;
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
      return Memory.find({ userId: uid, isDeleted: false }).lean();
    }
    return inMemoryStore.filter((m) => m.userId === uid && !m.isDeleted);
  },

  async deleteMemory(userId, memoryId) {
    const uid = userId.toString();
    const mid = memoryId.toString();

    if (isMongoReady()) {
      await Memory.updateOne({ _id: mid, userId: uid }, { $set: { isDeleted: true } });
    } else {
      const idx = inMemoryStore.findIndex((m) => m._id.toString() === mid && m.userId === uid);
      if (idx !== -1) {
        inMemoryStore[idx].isDeleted = true;
      }
    }
    await bumpVersion(uid, "memory");
    return true;
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
};
