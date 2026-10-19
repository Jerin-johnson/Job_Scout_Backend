import { Request, Response, NextFunction } from "express";
import { profileRepository } from "../../../infrastructure/database/mongoose/repositories/MongooseProfileRepository.js";
import { applicationRepository } from "../../../infrastructure/database/mongoose/repositories/MongooseApplicationRepository.js";
import { longTermMemory } from "../../../ai/memory/longTerm.js";
import {
  userRepository,
  UserRecord,
} from "../../../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";
import { Document } from "../../../infrastructure/database/mongoose/models/DocumentModel.js";
import { isMongoReady } from "../../../config/database.js";
import { logger } from "../../../shared/utils/logger.js";
import { InterviewMessage } from "../../../infrastructure/database/mongoose/models/InterviewMessageModel.js";
import { InterviewReport } from "../../../infrastructure/database/mongoose/models/InterviewReportModel.js";
import { InterviewSession } from "../../../infrastructure/database/mongoose/models/InterviewSessionModel.js";
import { interviewGraph } from "../../../ai/graphs/interviewGraph.js";
import { JobMatchReport } from "../../../infrastructure/database/mongoose/models/JobMatchReportModel.js";
import { Resume } from "../../../infrastructure/database/mongoose/models/ResumeModel.js";
import { Profile } from "../../../infrastructure/database/mongoose/models/ProfileModel.js";
import { Application } from "../../../infrastructure/database/mongoose/models/ApplicationModel.js";
import { deleteAllUserResumeData } from "../../../services/resumeDataLifecycle.js";
import { InteractionEvent } from "../../../infrastructure/database/mongoose/models/InteractionEventModel.js";
import { interactionActorKey } from "../../../services/jobs/interactionEvents.js";
import { UserFeedback } from "../../../infrastructure/database/mongoose/models/UserFeedbackModel.js";
import { savedSearchService } from "../../../services/jobs/savedSearchService.js";
import { ChatSession } from "../../../infrastructure/database/mongoose/models/ChatSessionModel.js";
import { purgeUserCheckpoints } from "../../../ai/checkpointer.js";

function getUserId(user?: UserRecord): string {
  if (!user) return "";
  return user._id
    ? user._id.toString()
    : (user as unknown as { id?: string }).id
      ? (user as unknown as { id?: string }).id!.toString()
      : "";
}

export const privacyController = {
  /**
   * GET /api/v1/privacy/export
   * Exports full candidate data portfolio as JSON (GDPR / India DPDP Article 12)
   */
  async exportData(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const user = req.user as UserRecord;
      const userId = getUserId(user);

      const profile = await profileRepository.findByUserId(userId);
      const applications = await applicationRepository.findByUserId(userId);
      const memories = await longTermMemory.listUserMemories(userId);
      const savedSearches = await savedSearchService.exportForUser(userId);

      let documents: unknown[] = [];
      let interviews: unknown[] = [];
      let resumes: unknown[] = [];
      let jobMatchReports: unknown[] = [];
      let interactionEvents: unknown[] = [];
      let feedback: unknown[] = [];
      let chatSessions: unknown[] = [];
      if (isMongoReady()) {
        documents = await Document.find({ userId }).lean();
        [resumes, jobMatchReports] = await Promise.all([
          Resume.find({ userId }).select("-encryptedRawText").lean(),
          JobMatchReport.find({ userId }).lean(),
        ]);
        const interviewDocs = (await InterviewSession.find({ userId })
          .select("-questionPlan")
          .lean()) as Record<string, unknown>[];
        const interviewIds = interviewDocs.map((session) => session._id);
        const [messages, reports] = await Promise.all([
          InterviewMessage.find({ userId, interviewId: { $in: interviewIds } })
            .select("-userId -idempotencyKey")
            .lean(),
          InterviewReport.find({ userId, interviewId: { $in: interviewIds } }).lean(),
        ]);
        interviews = interviewDocs.map((session) => ({
          ...session,
          transcript: (messages as Record<string, unknown>[]).filter(
            (message) => String(message.interviewId) === String(session._id),
          ),
          report:
            ((reports as Record<string, unknown>[]).find(
              (report) => String(report.interviewId) === String(session._id),
            )?.report as unknown) || null,
        }));
        interactionEvents = await InteractionEvent.find({ actorKey: interactionActorKey(userId) })
          .select("-actorKey")
          .sort({ createdAt: -1 })
          .lean();
        feedback = await UserFeedback.find({ userId })
          .select("category message createdAt")
          .sort({ createdAt: -1 })
          .lean();
        chatSessions = await ChatSession.find({ userId, isDeleted: false }).lean();
      }

      const exportBundle = {
        exportedAt: new Date().toISOString(),
        complianceFrameworks: ["GDPR (EU 2016/679)", "India DPDP Act 2023"],
        user: {
          id: userId,
          email: user?.email,
          name: user?.name,
          plan: user?.plan,
          createdAt: user?.createdAt,
          jobAnalyticsConsent: user?.jobAnalyticsConsent || { acceptedAt: null, version: null },
        },
        profile: profile || {},
        applications: applications || [],
        savedSearches: savedSearches || [],
        tailoredDocuments: documents,
        resumes,
        jobMatchReports,
        agentMemories: memories || [],
        chatSessions: chatSessions || [],
        interviews,
        interactionEvents,
        feedback,
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
  async deleteAccount(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
    try {
      const user = req.user as UserRecord;
      const userId = getUserId(user);

      // 1. Purge agent memories & chat checkpoints
      await longTermMemory.forgetAllMemories(userId);
      await deleteAllUserResumeData(userId);
      await savedSearchService.deleteAllForUser(userId);
      await purgeUserCheckpoints(userId).catch(() => {});

      // Remove durable interview transcripts/reports and legacy process-local sessions.
      if (isMongoReady()) {
        await Promise.all([
          InterviewMessage.deleteMany({ userId }),
          InterviewReport.deleteMany({ userId }),
          InterviewSession.deleteMany({ userId }),
          Profile.deleteOne({ userId }),
          Document.deleteMany({ userId }),
          Application.deleteMany({ userId }),
          InteractionEvent.deleteMany({ actorKey: interactionActorKey(userId) }),
          UserFeedback.deleteMany({ userId }),
          ChatSession.deleteMany({ userId }),
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
