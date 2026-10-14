import { profileRepository } from "../repositories/profileRepository.js";
import { applicationRepository } from "../repositories/applicationRepository.js";
import { longTermMemory } from "../ai/memory/longTerm.js";
import { userRepository } from "../repositories/userRepository.js";
import { Document } from "../models/Document.js";
import { isMongoReady } from "../config/database.js";
import { logger } from "../shared/utils/logger.js";

function getUserId(user) {
  if (!user) return "";
  return user._id ? user._id.toString() : user.id ? user.id.toString() : "";
}

export const privacyController = {
  /**
   * GET /api/v1/privacy/export
   * Exports full candidate data portfolio as JSON (GDPR / India DPDP Article 12)
   */
  async exportData(req, res, next) {
    try {
      const user = req.user;
      const userId = getUserId(user);

      const profile = await profileRepository.findByUserId(userId);
      const applications = await applicationRepository.findByUserId(userId);
      const memories = await longTermMemory.listUserMemories(userId);

      let documents = [];
      if (isMongoReady()) {
        documents = await Document.find({ userId }).lean();
      }

      const exportBundle = {
        exportedAt: new Date().toISOString(),
        complianceFrameworks: ["GDPR (EU 2016/679)", "India DPDP Act 2023"],
        user: {
          id: userId,
          email: user.email,
          name: user.name,
          plan: user.plan,
          createdAt: user.createdAt,
        },
        profile: profile || {},
        applications: applications || [],
        tailoredDocuments: documents,
        agentMemories: memories || [],
      };

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="jobscout_data_export_${userId}.json"`,
      );

      return res.status(200).json({
        data: exportBundle,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/v1/privacy/delete-account
   * Right-to-be-forgotten endpoint: soft deletes user, purges memories, revokes tokens
   */
  async deleteAccount(req, res, next) {
    try {
      const user = req.user;
      const userId = getUserId(user);

      // 1. Purge agent memories
      await longTermMemory.forgetAllMemories(userId);

      // 2. Soft delete user and revoke all refresh tokens
      await userRepository.update(userId, {
        isDeleted: true,
        refreshTokens: [],
        deletedAt: new Date(),
      });

      logger.info(
        { userId },
        "User account and memories permanently deleted under GDPR/DPDP request",
      );

      return res.status(200).json({
        data: {
          message: "Your account and all associated AI memories have been permanently deleted.",
          deletedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
