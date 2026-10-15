import mongoose from "mongoose";
import { InterviewMessage } from "../models/InterviewMessage.js";
import { InterviewReport } from "../models/InterviewReport.js";
import { InterviewSession } from "../models/InterviewSession.js";
import { User } from "../models/User.js";

export function ownedSessionFilter(id, userId) {
  return { _id: id, userId };
}

export const interviewRepository = {
  createSession(data) {
    return InterviewSession.create(data);
  },
  findSession(id, userId) {
    if (!mongoose.isValidObjectId(id)) return Promise.resolve(null);
    return InterviewSession.findOne(ownedSessionFilter(id, userId));
  },
  findSessionForDeletion(id, userId) {
    if (!mongoose.isValidObjectId(id)) return Promise.resolve(null);
    return InterviewSession.findOne(ownedSessionFilter(id, userId)).select(
      "resumeFileHash createdAt pinnedAt",
    );
  },
  async setPinned(id, userId, pinned, retentionDays) {
    const session = await InterviewSession.findOne(ownedSessionFilter(id, userId));
    if (!session) return null;
    const pinnedAt = pinned ? new Date() : null;
    const retentionExpiresAt = pinned
      ? null
      : new Date(session.createdAt.getTime() + retentionDays * 86_400_000);
    await Promise.all([
      InterviewSession.updateOne(ownedSessionFilter(id, userId), {
        $set: { pinnedAt, retentionExpiresAt },
      }),
      InterviewMessage.updateMany({ interviewId: id, userId }, { $set: { retentionExpiresAt } }),
      InterviewReport.updateOne({ interviewId: id, userId }, { $set: { retentionExpiresAt } }),
    ]);
    return { pinned: Boolean(pinned), retentionExpiresAt };
  },
  listSessions(userId, { page = 1, limit = 20 } = {}) {
    return InterviewSession.find({ userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
  },
  expirePastSessions(now = new Date()) {
    return InterviewSession.updateMany(
      { status: "in_progress", endsAt: { $lte: now } },
      { $set: { status: "expired" } },
    );
  },
  countTrialSessions(userId) {
    return InterviewSession.countDocuments({ userId, isFreeTrial: true });
  },
  async reserveStartQuota({ userId, sessionId, day, isPremium, limit }) {
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
      ],
      { new: true },
    ).select("_id mockInterviewQuotaCount");
    return reservation
      ? {
          day,
          isFreeTrial: false,
          remaining: Math.max(0, limit - reservation.mockInterviewQuotaCount),
        }
      : null;
  },
  updateUserTimezone(userId, timezone) {
    return User.updateOne({ _id: userId }, { $set: { timezone } });
  },
  async releaseStartQuota({ userId, sessionId, day, isPremium }) {
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
  async reserveTokens(id, userId, tokens, { preserveTokens = 0, allowExpired = false } = {}) {
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
  async allocateSequence(id, userId, count = 1) {
    const session = await InterviewSession.findOneAndUpdate(
      { _id: id, userId, status: "in_progress" },
      { $inc: { nextSequence: count } },
      { new: true },
    ).select("nextSequence");
    return session ? session.nextSequence - count + 1 : null;
  },
  claimQuestion(id, userId, questionIndex, claimKey) {
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
  releaseAnswerClaim(id, userId, questionIndex, claimKey, tokenReservation = 0) {
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
  deleteMessage(id, userId) {
    return InterviewMessage.deleteOne({ _id: id, userId });
  },
  finishAnswerClaim(id, userId, questionIndex, claimKey, claimIndex = questionIndex) {
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
  createMessage(data) {
    return InterviewMessage.create(data);
  },
  findMessageByIdempotency(interviewId, key) {
    return InterviewMessage.findOne({ interviewId, idempotencyKey: key }).select(
      "+idempotentResponse",
    );
  },
  findQuestionBefore(interviewId, userId, sequence) {
    return InterviewMessage.findOne({
      interviewId,
      userId,
      role: "interviewer",
      sequence: { $lt: sequence },
    })
      .sort({ sequence: -1 })
      .lean();
  },
  findResponseTo(interviewId, userId, messageId) {
    return InterviewMessage.findOne({ interviewId, userId, respondsToMessageId: messageId }).lean();
  },
  findPrompt(interviewId, userId, promptIndex) {
    return InterviewMessage.findOne({
      interviewId,
      userId,
      role: "interviewer",
      promptIndex,
    }).lean();
  },
  updateMessageEvaluation(id, evaluation, idempotentResponse) {
    return InterviewMessage.findByIdAndUpdate(
      id,
      { $set: { evaluation, idempotentResponse } },
      { new: true, select: "+idempotentResponse" },
    );
  },
  updateMessageClaim(id, claimKey, claimExpiresAt) {
    return InterviewMessage.updateOne(
      { _id: id, evaluation: { processing: true } },
      { $set: { claimKey, claimExpiresAt } },
    );
  },
  updateQuestionIndex(id, userId, index) {
    return InterviewSession.updateOne(
      { _id: id, userId, status: "in_progress" },
      { $max: { currentQuestionIndex: index } },
    );
  },
  updateSessionReportStatus(id, userId, reportStatus) {
    return InterviewSession.updateOne({ _id: id, userId }, { $set: { reportStatus } });
  },
  listMessages(interviewId, userId) {
    return InterviewMessage.find({ interviewId, userId }).sort({ sequence: 1 }).lean();
  },
  findLatestInterviewerMessage(interviewId, userId) {
    return InterviewMessage.findOne({ interviewId, userId, role: "interviewer" })
      .sort({ sequence: -1 })
      .lean();
  },
  startSession(id, userId, startedAt, endsAt) {
    return InterviewSession.findOneAndUpdate(
      { _id: id, userId, status: "ready" },
      { $set: { status: "in_progress", startedAt, endsAt } },
      { new: true },
    );
  },
  updateStartReservation(id, userId, day, isFreeTrial) {
    return InterviewSession.findOneAndUpdate(
      { _id: id, userId, status: "ready" },
      { $set: { quotaReservationDay: day, isFreeTrial } },
      { new: true },
    );
  },
  setStatus(id, userId, from, status, extra = {}) {
    return InterviewSession.findOneAndUpdate(
      { _id: id, userId, status: from },
      { $set: { status, ...extra } },
      { new: true },
    );
  },
  findReport(interviewId, userId) {
    if (!mongoose.isValidObjectId(interviewId)) return Promise.resolve(null);
    return InterviewReport.findOne({ interviewId, userId }).lean();
  },
  createReport(data) {
    return InterviewReport.create(data);
  },
  updateFallbackReport(interviewId, userId, data) {
    return InterviewReport.findOneAndUpdate(
      { interviewId, userId, "report.generatedBy": "fallback" },
      { $set: data },
      { new: true },
    ).lean();
  },
  async deleteSession(id, userId) {
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
