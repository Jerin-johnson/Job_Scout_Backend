import { profileRepository } from "../repositories/MongooseProfileRepository.js";
import { applicationRepository } from "../repositories/MongooseApplicationRepository.js";
import { longTermMemory } from "../../../ai/memory/longTerm.js";
import { userRepository, UserRecord } from "../repositories/MongooseUserRepository.js";
import { Document } from "../models/DocumentModel.js";
import { isMongoReady } from "../../database.js";
import { logger } from "../../../../shared/utils/logger.js";
import { InterviewMessage } from "../models/InterviewMessageModel.js";
import { InterviewReport } from "../models/InterviewReportModel.js";
import { InterviewSession } from "../models/InterviewSessionModel.js";
import { interviewGraph } from "../../../ai/graphs/interviewGraph.js";
import { JobMatchReport } from "../models/JobMatchReportModel.js";
import { Resume } from "../models/ResumeModel.js";
import { Profile } from "../models/ProfileModel.js";
import { Application } from "../models/ApplicationModel.js";
import { deleteAllUserResumeData } from "./resumeDataLifecycle.js";
import { InteractionEvent } from "../models/InteractionEventModel.js";
import { interactionActorKey } from "./interactionEvents.js";
import { UserFeedback } from "../models/UserFeedbackModel.js";
import { savedSearchService } from "./savedSearchService.js";
import { ChatSession } from "../models/ChatSessionModel.js";
import { purgeUserCheckpoints } from "../../../ai/checkpointer.js";

export interface DataExportBundle {
  exportedAt: string;
  complianceFrameworks: string[];
  user: {
    id: string;
    email?: string;
    name?: string;
    plan?: string;
    createdAt?: Date;
    jobAnalyticsConsent?: { acceptedAt?: Date | null; version?: string | null };
  };
  profile: unknown;
  applications: unknown[];
  savedSearches: unknown[];
  tailoredDocuments: unknown[];
  resumes: unknown[];
  jobMatchReports: unknown[];
  agentMemories: unknown[];
  chatSessions: unknown[];
  interviews: unknown[];
  interactionEvents: unknown[];
  feedback: unknown[];
}

export interface AccountDeletionResult {
  message: string;
  deletedAt: string;
}

export const privacyService = {
  /**
   * Exports full candidate data portfolio as JSON (GDPR / India DPDP Article 12)
   */
  async exportUserData(user: UserRecord, userId: string): Promise<DataExportBundle> {
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

    return {
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
  },

  /**
   * Right-to-be-forgotten: soft deletes user, purges memories, revokes tokens, cascades deletions
   */
  async deleteUserAccount(userId: string): Promise<AccountDeletionResult> {
    // 1. Purge agent memories & chat checkpoints
    await longTermMemory.forgetAllMemories(userId);
    await deleteAllUserResumeData(userId);
    await savedSearchService.deleteAllForUser(userId);
    await purgeUserCheckpoints(userId).catch(() => {});

    // 2. Remove durable interview transcripts/reports and persistence records
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

    // 3. Soft delete user and revoke all refresh tokens
    await userRepository.update(userId, {
      isDeleted: true,
      refreshTokens: [],
      deletedAt: new Date(),
    });

    logger.info(
      { userId },
      "User account and memories permanently deleted under GDPR/DPDP request",
    );

    return {
      message: "Your account and all associated AI memories have been permanently deleted.",
      deletedAt: new Date().toISOString(),
    };
  },
};
