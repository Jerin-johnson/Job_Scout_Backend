import mongoose, { UpdateQuery } from "mongoose";
import { InterviewMessage } from "../models/InterviewMessage.js";
import { InterviewReport } from "../models/InterviewReport.js";
import { InterviewSession } from "../models/InterviewSession.js";
import { User } from "../models/User.js";

export function ownedSessionFilter(
  id: string | mongoose.Types.ObjectId,
  userId: string | mongoose.Types.ObjectId,
): { _id: string | mongoose.Types.ObjectId; userId: string | mongoose.Types.ObjectId } {
  return { _id: id, userId };
}

export interface ListSessionsOptions {
  page?: number;
  limit?: number;
}

export interface ReserveStartQuotaParams {
  userId: string | mongoose.Types.ObjectId;
  sessionId: string;
  day: string;
  isPremium: boolean;
  limit: number;
}

export interface ReleaseStartQuotaParams {
  userId: string | mongoose.Types.ObjectId;
  sessionId: string;
  day: string;
  isPremium: boolean;
}

export interface ReserveTokensOptions {
  preserveTokens?: number;
  allowExpired?: boolean;
}

export const interviewRepository = {
  createSession(data: Record<string, unknown>) {
    return InterviewSession.create(data);
  },

  findSession(id: string | mongoose.Types.ObjectId, userId: string | mongoose.Types.ObjectId) {
    if (!mongoose.isValidObjectId(id)) return Promise.resolve(null);
    return InterviewSession.findOne(ownedSessionFilter(id, userId));
  },

  findSessionForDeletion(id: string | mongoose.Types.ObjectId, userId: string | mongoose.Types.ObjectId) {
    if (!mongoose.isValidObjectId(id)) return Promise.resolve(null);
    return InterviewSession.findOne(ownedSessionFilter(id, userId)).select(
      "resumeFileHash createdAt pinnedAt",
    );
  },

  async setPinned(
    id: string | mongoose.Types.ObjectId,
    userId: string | mongoose.Types.ObjectId,
    pinned: boolean,
    retentionDays: number,
  ): Promise<{ pinned: boolean; retentionExpiresAt: Date | null } | null> {
    const session = await InterviewSession.findOne(ownedSessionFilter(id, userId));
    if (!session) return null;
    const pinnedAt = pinned ? new Date() : null;
    const createdAt = (session as unknown as { createdAt: Date }).createdAt;
    const retentionExpiresAt = pinned
      ? null
      : new Date(createdAt.getTime() + retentionDays * 86_400_000);
    await Promise.all([
      InterviewSession.updateOne(ownedSessionFilter(id, userId), {
        $set: { pinnedAt, retentionExpiresAt },
      }),
      InterviewMessage.updateMany({ interviewId: id, userId }, { $set: { retentionExpiresAt } }),
      InterviewReport.updateOne({ interviewId: id, userId }, { $set: { retentionExpiresAt } }),
    ]);
    return { pinned: Boolean(pinned), retentionExpiresAt };
  },

  listSessions(userId: string | mongoose.Types.ObjectId, { page = 1, limit = 20 }: ListSessionsOptions = {}) {
    return InterviewSession.find({ userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
  },

  expirePastSessions(now: Date = new Date()) {
    return InterviewSession.updateMany(
      { status: "in_progress", endsAt: { $lte: now } },
      { $set: { status: "expired" } },
    );
  },

  countTrialSessions(userId: string | mongoose.Types.ObjectId) {
    return InterviewSession.countDocuments({ userId, isFreeTrial: true });
  },

  async reserveStartQuota({ userId, sessionId, day, isPremium, limit }: ReserveStartQuotaParams) {
    if (!isPremium) {
      const claimed = await User.findOneAndUpdate(
        {
          _id: userId,
          $or: [
            { mockInterviewTrialSessionId: sessionId },
            { mockInterviewTrialUsedAt: { $exists: false } },
            { mockInterviewTrialUsedAt: null },
          ],
        },
        {
          $set: {
            mockInterviewTrialUsedAt: new Date(),
            mockInterviewTrialSessionId: sessionId,
          },
        },
        { new: true },
      ).select("_id");
      return claimed ? { day, isFreeTrial: true } : null;
    }

    const sessionObjectId = new mongoose.Types.ObjectId(sessionId);
    const currentDay = { $eq: ["$mockInterviewQuotaDay", day] };
    const reservation = await User.findOneAndUpdate(
      {
        _id: userId,
        plan: "premium",
        $or: [
          { mockInterviewQuotaDay: { $ne: day } },
          { mockInterviewQuotaDay: day, mockInterviewQuotaCount: { $lt: limit } },
          { mockInterviewQuotaDay: day, mockInterviewQuotaSessionIds: sessionObjectId },
        ],
      },
      [
        {
          $set: {
            mockInterviewQuotaDay: day,
            mockInterviewQuotaCount: {
              $cond: [
                currentDay,
                {
                  $cond: [
                    { $in: [sessionObjectId, { $ifNull: ["$mockInterviewQuotaSessionIds", []] }] },
                    "$mockInterviewQuotaCount",
                    { $add: [{ $ifNull: ["$mockInterviewQuotaCount", 0] }, 1] },
                  ],
                },
                1,
              ],
            },
            mockInterviewQuotaSessionIds: {
              $cond: [
                currentDay,
                {
                  $setUnion: [
                    { $ifNull: ["$mockInterviewQuotaSessionIds", []] },
                    [sessionObjectId],
                  ],
                },
                [sessionObjectId],
              ],
            },
          },
        },
      ] as unknown as UpdateQuery<unknown>,
      { new: true },
    ).select("_id mockInterviewQuotaCount");
    const count = (reservation as unknown as { mockInterviewQuotaCount?: number })?.mockInterviewQuotaCount ?? 0;
    return reservation
      ? {
          day,
          isFreeTrial: false,
          remaining: Math.max(0, limit - count),
        }
      : null;
  },

  updateUserTimezone(userId: string | mongoose.Types.ObjectId, timezone: string) {
    return User.updateOne({ _id: userId }, { $set: { timezone } });
  },

  async releaseStartQuota({ userId, sessionId, day, isPremium }: ReleaseStartQuotaParams) {
    if (!isPremium) {
      await User.updateOne(
        { _id: userId, mockInterviewTrialSessionId: sessionId },
        { $unset: { mockInterviewTrialUsedAt: 1, mockInterviewTrialSessionId: 1 } },
      );
      return;
    }
    await User.updateOne(
      { _id: userId, mockInterviewQuotaDay: day, mockInterviewQuotaSessionIds: sessionId },
      { $pull: { mockInterviewQuotaSessionIds: sessionId }, $inc: { mockInterviewQuotaCount: -1 } },
    );
  },

  async reserveTokens(
    id: string | mongoose.Types.ObjectId,
    userId: string | mongoose.Types.ObjectId,
    tokens: number,
    { preserveTokens = 0, allowExpired = false }: ReserveTokensOptions = {},
  ) {
    return InterviewSession.findOneAndUpdate(
      {
        _id: id,
        userId,
        status: allowExpired ? { $in: ["in_progress", "expired", "completed"] } : "in_progress",
        $expr: {
          $lte: [{ $add: ["$estimatedTokensUsed", tokens, preserveTokens] }, "$tokenCap"],
        },
      },
      { $inc: { estimatedTokensUsed: tokens } },
      { new: true },
    );
  },

  async allocateSequence(id: string | mongoose.Types.ObjectId, userId: string | mongoose.Types.ObjectId, count: number = 1) {
    const session = await InterviewSession.findOneAndUpdate(
      { _id: id, userId, status: "in_progress" },
      { $inc: { nextSequence: count } },
      { new: true },
    ).select("nextSequence");
    const nextSeq = (session as unknown as { nextSequence?: number })?.nextSequence;
    return nextSeq !== undefined ? nextSeq - count + 1 : null;
  },

  claimQuestion(id: string | mongoose.Types.ObjectId, userId: string | mongoose.Types.ObjectId, questionIndex: number, claimKey: string) {
    return InterviewSession.findOneAndUpdate(
      {
        _id: id,
        userId,
        status: "in_progress",
        currentQuestionIndex: questionIndex,
        answeredQuestionIndexes: { $ne: questionIndex },
        $or: [
          { activeAnswerClaimKey: { $exists: false } },
          { activeAnswerClaimIndex: { $ne: questionIndex } },
          { activeAnswerClaimExpiresAt: { $lt: new Date() } },
        ],
        endsAt: { $gt: new Date() },
      },
      {
        $set: {
          activeAnswerClaimIndex: questionIndex,
          activeAnswerClaimKey: claimKey,
          activeAnswerClaimExpiresAt: new Date(Date.now() + 90_000),
        },
      },
      { new: true },
    );
  },

  releaseAnswerClaim(
    id: string | mongoose.Types.ObjectId,
    userId: string | mongoose.Types.ObjectId,
    questionIndex: number,
    claimKey: string,
    tokenReservation: number = 0,
  ) {
    return Promise.all([
      InterviewSession.updateOne(
        { _id: id, userId, activeAnswerClaimIndex: questionIndex, activeAnswerClaimKey: claimKey },
        {
          $unset: {
            activeAnswerClaimIndex: 1,
            activeAnswerClaimKey: 1,
            activeAnswerClaimExpiresAt: 1,
          },
          ...(tokenReservation ? { $inc: { estimatedTokensUsed: -tokenReservation } } : {}),
        },
      ),
      InterviewSession.updateOne(
        { _id: id, userId, answeredQuestionIndexes: questionIndex },
        { $pull: { answeredQuestionIndexes: questionIndex } },
      ),
    ]);
  },

  deleteMessage(id: string | mongoose.Types.ObjectId, userId: string | mongoose.Types.ObjectId) {
    return InterviewMessage.deleteOne({ _id: id, userId });
  },

  finishAnswerClaim(
    id: string | mongoose.Types.ObjectId,
    userId: string | mongoose.Types.ObjectId,
    questionIndex: number,
    claimKey: string,
    claimIndex: number = questionIndex,
  ) {
    return InterviewSession.updateOne(
      { _id: id, userId, activeAnswerClaimIndex: claimIndex, activeAnswerClaimKey: claimKey },
      {
        $addToSet: { answeredQuestionIndexes: questionIndex },
        $unset: {
          activeAnswerClaimIndex: 1,
          activeAnswerClaimKey: 1,
          activeAnswerClaimExpiresAt: 1,
        },
      },
    );
  },

  createMessage(data: Record<string, unknown>) {
    return InterviewMessage.create(data);
  },

  findMessageByIdempotency(interviewId: string | mongoose.Types.ObjectId, key: string) {
    return InterviewMessage.findOne({ interviewId, idempotencyKey: key }).select(
      "+idempotentResponse",
    );
  },

  findQuestionBefore(interviewId: string | mongoose.Types.ObjectId, userId: string | mongoose.Types.ObjectId, sequence: number) {
    return InterviewMessage.findOne({
      interviewId,
      userId,
      role: "interviewer",
      sequence: { $lt: sequence },
    })
      .sort({ sequence: -1 })
      .lean();
  },

  findResponseTo(interviewId: string | mongoose.Types.ObjectId, userId: string | mongoose.Types.ObjectId, messageId: string | mongoose.Types.ObjectId) {
    return InterviewMessage.findOne({ interviewId, userId, respondsToMessageId: messageId }).lean();
  },

  findPrompt(interviewId: string | mongoose.Types.ObjectId, userId: string | mongoose.Types.ObjectId, promptIndex: number) {
    return InterviewMessage.findOne({
      interviewId,
      userId,
      role: "interviewer",
      promptIndex,
    }).lean();
  },

  updateMessageEvaluation(
    id: string | mongoose.Types.ObjectId,
    evaluation: unknown,
    idempotentResponse: unknown,
  ) {
    return InterviewMessage.findByIdAndUpdate(
      id,
      { $set: { evaluation, idempotentResponse } },
      { new: true, select: "+idempotentResponse" },
    );
  },

  updateMessageClaim(id: string | mongoose.Types.ObjectId, claimKey: string, claimExpiresAt: Date) {
    return InterviewMessage.updateOne(
      { _id: id, "evaluation.processing": true },
      { $set: { claimKey, claimExpiresAt } },
    );
  },

  updateQuestionIndex(id: string | mongoose.Types.ObjectId, userId: string | mongoose.Types.ObjectId, index: number) {
    return InterviewSession.updateOne(
      { _id: id, userId, status: "in_progress" },
      { $max: { currentQuestionIndex: index } },
    );
  },

  updateSessionReportStatus(id: string | mongoose.Types.ObjectId, userId: string | mongoose.Types.ObjectId, reportStatus: string) {
    return InterviewSession.updateOne({ _id: id, userId }, { $set: { reportStatus } });
  },

  listMessages(interviewId: string | mongoose.Types.ObjectId, userId: string | mongoose.Types.ObjectId) {
    return InterviewMessage.find({ interviewId, userId }).sort({ sequence: 1 }).lean();
  },

  findLatestInterviewerMessage(interviewId: string | mongoose.Types.ObjectId, userId: string | mongoose.Types.ObjectId) {
    return InterviewMessage.findOne({ interviewId, userId, role: "interviewer" })
      .sort({ sequence: -1 })
      .lean();
  },

  startSession(
    id: string | mongoose.Types.ObjectId,
    userId: string | mongoose.Types.ObjectId,
    startedAt: Date,
    endsAt: Date,
  ) {
    return InterviewSession.findOneAndUpdate(
      { _id: id, userId, status: "ready" },
      { $set: { status: "in_progress", startedAt, endsAt } },
      { new: true },
    );
  },

  updateStartReservation(
    id: string | mongoose.Types.ObjectId,
    userId: string | mongoose.Types.ObjectId,
    day: string,
    isFreeTrial: boolean,
  ) {
    return InterviewSession.findOneAndUpdate(
      { _id: id, userId, status: "ready" },
      { $set: { quotaReservationDay: day, isFreeTrial } },
      { new: true },
    );
  },

  setStatus(
    id: string | mongoose.Types.ObjectId,
    userId: string | mongoose.Types.ObjectId,
    from: string,
    status: string,
    extra: Record<string, unknown> = {},
  ) {
    return InterviewSession.findOneAndUpdate(
      { _id: id, userId, status: from },
      { $set: { status, ...extra } },
      { new: true },
    );
  },

  findReport(interviewId: string | mongoose.Types.ObjectId, userId: string | mongoose.Types.ObjectId) {
    if (!mongoose.isValidObjectId(interviewId)) return Promise.resolve(null);
    return InterviewReport.findOne({ interviewId, userId }).lean();
  },

  createReport(data: Record<string, unknown>) {
    return InterviewReport.create(data);
  },

  updateFallbackReport(
    interviewId: string | mongoose.Types.ObjectId,
    userId: string | mongoose.Types.ObjectId,
    data: Record<string, unknown>,
  ) {
    return InterviewReport.findOneAndUpdate(
      { interviewId, userId, "report.generatedBy": "fallback" },
      { $set: data },
      { new: true },
    ).lean();
  },

  async deleteSession(id: string | mongoose.Types.ObjectId, userId: string | mongoose.Types.ObjectId): Promise<boolean> {
    if (!mongoose.isValidObjectId(id)) return false;
    const session = await InterviewSession.findOneAndDelete({ _id: id, userId });
    if (session)
      await Promise.all([
        InterviewMessage.deleteMany({ interviewId: id, userId }),
        InterviewReport.deleteOne({ interviewId: id, userId }),
      ]);
    return Boolean(session);
  },
};
