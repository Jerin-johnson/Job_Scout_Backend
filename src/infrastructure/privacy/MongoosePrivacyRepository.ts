import { injectable } from "tsyringe";
import { IPrivacyRepository } from "../../domain/repositories/IPrivacyRepository.js";
import { profileRepository } from "../database/mongoose/repositories/MongooseProfileRepository.js";
import { applicationRepository } from "../database/mongoose/repositories/MongooseApplicationRepository.js";
import { longTermMemory } from "../ai/memory/longTerm.js";
import {
  userRepository,
  type UserRecord,
} from "../database/mongoose/repositories/MongooseUserRepository.js";
import { Document } from "../database/mongoose/models/DocumentModel.js";
import { isMongoReady } from "../database/database.js";
import { logger } from "../../shared/utils/logger.js";
import { InterviewMessage } from "../database/mongoose/models/InterviewMessageModel.js";
import { InterviewReport } from "../database/mongoose/models/InterviewReportModel.js";
import { InterviewSession } from "../database/mongoose/models/InterviewSessionModel.js";
import { interviewGraph } from "../ai/graphs/interviewGraph.js";
import { JobMatchReport } from "../database/mongoose/models/JobMatchReportModel.js";
import { Resume } from "../database/mongoose/models/ResumeModel.js";
import { Profile } from "../database/mongoose/models/ProfileModel.js";
import { Application } from "../database/mongoose/models/ApplicationModel.js";
import { InteractionEvent } from "../database/mongoose/models/InteractionEventModel.js";
import { interactionActorKey } from "../../domain/services/analytics/interactionEvents.js";
import { UserFeedback } from "../database/mongoose/models/UserFeedbackModel.js";
import { savedSearchService } from "../database/mongoose/repositories/MongooseSavedSearchRepository.js";
import { ChatSession } from "../database/mongoose/models/ChatSessionModel.js";
import { purgeUserCheckpoints } from "../ai/checkpointer.js";
import { storageService } from "../storage/storageService.js";
import { CacheKeys, del } from "../../shared/cache.js";
import { QuizAttemptModel } from "../database/mongoose/models/QuizAttemptModel.js";

export interface DataExportBundle {
  exportedAt: string;
  complianceFrameworks: string[];
  user: {
    id: string;
    email?: string;
    name?: string;
    plan?: string;
    createdAt?: Date;
    jobAnalyticsConsent?: unknown;
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
  quizAttempts: unknown[];
  interactionEvents: unknown[];
  feedback: unknown[];
}

export interface AccountDeletionResult {
  message: string;
  deletedAt: string;
}

async function deleteAllUserResumeDataInternal(userId: string): Promise<number> {
  if (!isMongoReady()) return 0;
  const resumes = (await Resume.find({ userId }).select("_id s3Key fileHash").lean()) as Array<{
    _id: unknown;
    s3Key: string;
    fileHash: string;
  }>;
  for (let offset = 0; offset < resumes.length; offset += 10) {
    await Promise.all(
      resumes
        .slice(offset, offset + 10)
        .map((resume) => storageService.deleteFile({ key: resume.s3Key })),
    );
  }
  await JobMatchReport.deleteMany({ userId });
  await Resume.deleteMany({ userId });
  for (const resume of resumes) {
    await del(CacheKeys.resumeParse(`${userId}:${resume.fileHash}:resume-match-v1`));
  }
  return resumes.length;
}

export const privacyService = {
  async exportUserData(user: UserRecord | null, userId: string): Promise<DataExportBundle> {
    const profile = await profileRepository.findByUserId(userId);
    const applications = await applicationRepository.findByUserId(userId);
    const memories = await longTermMemory.listUserMemories(userId);
    const savedSearches = await savedSearchService.exportForUser(userId);

    let documents: unknown[] = [];
    let interviews: unknown[] = [];
    let quizAttempts: unknown[] = [];
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
        messages: messages.filter(
          (m: Record<string, unknown>) =>
            m.interviewId && m.interviewId.toString() === (session._id as object).toString(),
        ),
        report:
          reports.find(
            (r: Record<string, unknown>) =>
              r.interviewId && r.interviewId.toString() === (session._id as object).toString(),
          ) ?? null,
      }));
      [interactionEvents, feedback, chatSessions] = await Promise.all([
        InteractionEvent.find({ actorKey: interactionActorKey(userId) })
          .select("-actorKey")
          .lean(),
        UserFeedback.find({ userId }).lean(),
        ChatSession.find({ userId }).select("-messages").lean(),
      ]);
      quizAttempts = await QuizAttemptModel.find({ userId }).lean();
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
        jobAnalyticsConsent: user?.jobAnalyticsConsent,
      },
      profile,
      applications,
      savedSearches,
      tailoredDocuments: documents,
      resumes,
      jobMatchReports,
      agentMemories: memories,
      chatSessions,
      interviews,
      quizAttempts,
      interactionEvents,
      feedback,
    };
  },

  async deleteUserAccount(userId: string): Promise<AccountDeletionResult> {
    await longTermMemory.forgetAllMemories(userId);

    await Promise.all([
      purgeUserCheckpoints(userId).catch((err: unknown) => {
        logger.warn(
          { userId, err },
          "Failed to purge LangGraph checkpoints during account deletion",
        );
      }),
      deleteAllUserResumeDataInternal(userId),
    ]);

    if (isMongoReady()) {
      const quizSessions = await QuizAttemptModel.find({ userId }).select("quizSessionId").lean();
      await Promise.all([
        ...quizSessions.map((attempt) => del(CacheKeys.quizSession(userId, attempt.quizSessionId))),
        QuizAttemptModel.deleteMany({ userId }),
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

@injectable()
export class MongoosePrivacyRepository implements IPrivacyRepository {
  async exportUserData(userId: string): Promise<Record<string, unknown>> {
    const user = await userRepository.findById(userId);
    return (await privacyService.exportUserData(user, userId)) as unknown as Record<
      string,
      unknown
    >;
  }

  async deleteUserAccount(userId: string): Promise<{ message: string; deletedAt: string }> {
    return privacyService.deleteUserAccount(userId);
  }
}

export const privacyRepository = new MongoosePrivacyRepository();
