import { longTermMemory } from "../ai/memory/longTerm.js";
import { userRepository } from "../repositories/userRepository.js";

export const memoryController = {
  async list(req, res, next) {
    try {
      const userId = req.user._id ? req.user._id.toString() : req.user.id;
      const memories = await longTermMemory.listUserMemories(userId);

      res.status(200).json({
        data: {
          memories: memories.map((m) => ({
            id: m._id,
            type: m.type,
            key: m.key,
            content: m.content,
            importance: m.importance,
            createdAt: m.createdAt,
          })),
        },
      });
    } catch (err) {
      next(err);
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
      const updated = await userRepository.update(userId, {
        memoryPaused: !req.user.memoryPaused,
      });

      res.status(200).json({
        data: {
          memoryPaused: updated.memoryPaused,
          message: updated.memoryPaused
            ? "Memory capture paused"
            : "Memory capture resumed",
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
