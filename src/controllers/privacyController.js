import { profileRepository } from "../repositories/profileRepository.js";
import { applicationRepository } from "../repositories/applicationRepository.js";
import { longTermMemory } from "../ai/memory/longTerm.js";
import { userRepository } from "../repositories/userRepository.js";
import { Document } from "../models/Document.js";
import { isMongoReady } from "../config/database.js";
import { logger } from "../shared/utils/logger.js";
import { InterviewMessage } from "../models/InterviewMessage.js";
import { InterviewReport } from "../models/InterviewReport.js";
import { InterviewSession } from "../models/InterviewSession.js";
import { interviewGraph } from "../ai/graphs/interviewGraph.js";
import { JobMatchReport } from "../models/JobMatchReport.js";
import { Resume } from "../models/Resume.js";
import { Profile } from "../models/Profile.js";
import { Application } from "../models/Application.js";
import { deleteAllUserResumeData } from "../services/resumeDataLifecycle.js";

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
      let interviews = [];
      let resumes = [];
      let jobMatchReports = [];
      if (isMongoReady()) {
        documents = await Document.find({ userId }).lean();
        [resumes, jobMatchReports] = await Promise.all([
          Resume.find({ userId }).select("-encryptedRawText").lean(),
          JobMatchReport.find({ userId }).lean(),
        ]);
        interviews = await InterviewSession.find({ userId }).select("-questionPlan").lean();
        const interviewIds = interviews.map((session) => session._id);
        const [messages, reports] = await Promise.all([
          InterviewMessage.find({ userId, interviewId: { $in: interviewIds } })
            .select("-userId -idempotencyKey")
            .lean(),
          InterviewReport.find({ userId, interviewId: { $in: interviewIds } }).lean(),
        ]);
        interviews = interviews.map((session) => ({
          ...session,
          transcript: messages.filter(
            (message) => message.interviewId.toString() === session._id.toString(),
          ),
          report:
            reports.find((report) => report.interviewId.toString() === session._id.toString())
              ?.report || null,
        }));
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
        resumes,
        jobMatchReports,
        agentMemories: memories || [],
        interviews,
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
      await deleteAllUserResumeData(userId);

      // Remove durable interview transcripts/reports and legacy process-local sessions.
      if (isMongoReady()) {
        await Promise.all([
          InterviewMessage.deleteMany({ userId }),
          InterviewReport.deleteMany({ userId }),
          InterviewSession.deleteMany({ userId }),
          Profile.deleteOne({ userId }),
          Document.deleteMany({ userId }),
          Application.deleteMany({ userId }),
        ]);
      }
      interviewGraph.deleteMockSessionsByUserId(userId);

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
