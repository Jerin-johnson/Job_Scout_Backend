import { z } from "zod";
import { longTermMemory, MEMORY_CONSENT_VERSION, hasMemoryConsent } from "../ai/memory/longTerm.js";
import { userRepository } from "../repositories/userRepository.js";

const updateMemorySchema = z
  .object({
    key: z.string().trim().min(1).max(120).optional(),
    content: z.string().trim().min(1).max(1000).optional(),
    type: z.enum(["preference", "fact", "feedback", "episode", "goal"]).optional(),
    importance: z.number().int().min(1).max(5).optional(),
  })
  .strict();

const createMemorySchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(1000),
    type: z.enum(["preference", "fact", "feedback", "episode", "goal"]).default("preference"),
    importance: z.number().int().min(1).max(5).default(3),
  })
  .strict();

const consentSchema = z.discriminatedUnion("accepted", [
  z.object({ accepted: z.literal(true), version: z.literal(MEMORY_CONSENT_VERSION) }).strict(),
  z.object({ accepted: z.literal(false) }).strict(),
]);

export const memoryController = {
  async list(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const user = await userRepository.findById(userId).catch(() => req.user);
      const memories = await longTermMemory.listUserMemories(userId);

      res.status(200).json({
        data: {
          memories: memories.map((m) => ({
            id: m._id.toString(),
            type: m.type,
            key: m.key,
            content: m.content,
            importance: m.importance,
            confidence: m.confidence,
            source: m.source,
            createdAt: m.createdAt,
          })),
          memoryPaused: Boolean((user || req.user)?.memoryPaused),
          consent: {
            accepted: hasMemoryConsent(user || req.user),
            version: MEMORY_CONSENT_VERSION,
            acceptedAt: (user || req.user)?.memoryConsent?.acceptedAt || null,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async getConsent(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const user = await userRepository.findById(userId).catch(() => req.user);
      res.status(200).json({
        data: {
          accepted: hasMemoryConsent(user || req.user),
          version: MEMORY_CONSENT_VERSION,
          acceptedAt: (user || req.user)?.memoryConsent?.acceptedAt || null,
          memoryPaused: Boolean((user || req.user)?.memoryPaused),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async updateConsent(req, res, next) {
    try {
      const parsed = consentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: `Invalid memory consent payload. Version must be ${MEMORY_CONSENT_VERSION}.`,
            requestId: req.id,
          },
        });
      }
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      if (parsed.data.accepted) {
        const acceptedAt = new Date();
        await userRepository.update(userId, {
          memoryConsent: { acceptedAt, version: MEMORY_CONSENT_VERSION },
        });
        return res.status(200).json({
          data: {
            accepted: true,
            version: MEMORY_CONSENT_VERSION,
            acceptedAt,
          },
        });
      }
      await userRepository.update(userId, {
        memoryConsent: { acceptedAt: null, version: null },
      });
      await longTermMemory.forgetAll(userId);
      return res.status(200).json({
        data: {
          accepted: false,
          version: MEMORY_CONSENT_VERSION,
          acceptedAt: null,
        },
      });
    } catch (err) {
      return next(err);
    }
  },

  async create(req, res, next) {
    try {
      const parsed = createMemorySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message || "Invalid memory payload",
            requestId: req.id,
          },
        });
      }
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const user = await userRepository.findById(userId).catch(() => req.user);
      const saved = await longTermMemory.writeMemory({
        userId,
        user: user || req.user,
        userPlan: (user || req.user)?.plan,
        type: parsed.data.type,
        key: parsed.data.key,
        content: parsed.data.content,
        importance: parsed.data.importance,
        confidence: 1.0,
        source: "user_edit",
        requireConsent: true,
      });
      if (!saved) {
        return res.status(409).json({
          error: {
            code: "MEMORY_PAUSED",
            message: "Memory capture is currently paused.",
            requestId: req.id,
          },
        });
      }
      return res.status(201).json({
        data: {
          memory: {
            id: saved._id.toString(),
            type: saved.type,
            key: saved.key,
            content: saved.content,
            importance: saved.importance,
            confidence: saved.confidence,
            source: saved.source,
            createdAt: saved.createdAt,
          },
        },
      });
    } catch (err) {
      return next(err);
    }
  },

  async update(req, res, next) {
    try {
      const parsed = updateMemorySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message || "Invalid memory update payload",
            requestId: req.id,
          },
        });
      }
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const { id } = req.params;
      const updated = await longTermMemory.updateMemory(userId, id, parsed.data);
      if (!updated) {
        return res.status(404).json({
          error: {
            code: "MEMORY_NOT_FOUND",
            message: "Memory item not found",
            requestId: req.id,
          },
        });
      }
      return res.status(200).json({
        data: {
          memory: {
            id: updated._id.toString(),
            type: updated.type,
            key: updated.key,
            content: updated.content,
            importance: updated.importance,
            confidence: updated.confidence,
            source: updated.source,
            createdAt: updated.createdAt,
          },
        },
      });
    } catch (err) {
      return next(err);
    }
  },

  async delete(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const { id } = req.params;

      await longTermMemory.deleteMemory(userId, id);
      res.status(200).json({ data: { message: "Memory removed successfully" } });
    } catch (err) {
      next(err);
    }
  },

  async forgetAll(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;

      await longTermMemory.forgetAll(userId);
      res.status(200).json({ data: { message: "All candidate memories purged" } });
    } catch (err) {
      next(err);
    }
  },

  async togglePause(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const currentUser = await userRepository.findById(userId).catch(() => req.user);
      const updated = await userRepository.update(userId, {
        memoryPaused: !(currentUser || req.user).memoryPaused,
      });

      res.status(200).json({
        data: {
          memoryPaused: updated.memoryPaused,
          message: updated.memoryPaused ? "Memory capture paused" : "Memory capture resumed",
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
