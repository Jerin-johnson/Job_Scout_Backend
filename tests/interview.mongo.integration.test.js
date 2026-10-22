import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { User } from "../src/infrastructure/database/mongoose/models/UserModel.js";
import { InterviewMessage } from "../src/infrastructure/database/mongoose/models/InterviewMessageModel.js";
import { InterviewReport } from "../src/infrastructure/database/mongoose/models/InterviewReportModel.js";
import { InterviewSession } from "../src/infrastructure/database/mongoose/models/InterviewSessionModel.js";
import { interviewRepository as repo } from "../src/infrastructure/database/mongoose/repositories/MongooseInterviewRepository.js";
import { interviewSessionService } from "../src/infrastructure/interview/interviewSessionService.js";
import { INTERVIEW_CONSENT_VERSION } from "../src/shared/constants/interviews.js";

let MongoMemoryServer;
try {
  ({ MongoMemoryServer } = await import("mongodb-memory-server"));
} catch {
  // Optional test dependency; install it to run the real Mongo concurrency suite.
}

test(
  "Mongo integration: quota races, owner scoping, unique message sequence, report uniqueness",
  { skip: !(MongoMemoryServer && process.env.MOCK_INTERVIEW_MONGO_INTEGRATION === "true") },
  async () => {
    const server = await MongoMemoryServer.create();
    try {
      await mongoose.connect(server.getUri());
      await Promise.all([
        User.syncIndexes(),
        InterviewSession.syncIndexes(),
        InterviewMessage.syncIndexes(),
        InterviewReport.syncIndexes(),
      ]);
      const user = await User.create({
        email: "mongo-interview-test@example.com",
        plan: "premium",
      });
      const sessionIds = Array.from({ length: 6 }, () => new mongoose.Types.ObjectId().toString());
      const reservations = await Promise.all(
        sessionIds.map((sessionId) =>
          repo.reserveStartQuota({
            userId: user._id,
            sessionId,
            day: "2026-10-15",
            isPremium: true,
            limit: 3,
          }),
        ),
      );
      assert.equal(reservations.filter(Boolean).length, 3);
      const acceptedSessionId = sessionIds[reservations.findIndex(Boolean)];
      const repeated = await repo.reserveStartQuota({
        userId: user._id,
        sessionId: acceptedSessionId,
        day: "2026-10-15",
        isPremium: true,
        limit: 3,
      });
      assert.ok(repeated, "same session reservation is idempotent");

      const owner = user._id;
      const otherOwner = new mongoose.Types.ObjectId();
      const interviewId = new mongoose.Types.ObjectId();
      const session = await InterviewSession.create({
        _id: interviewId,
        userId: owner,
        resumeId: new mongoose.Types.ObjectId(),
        role: "Engineer",
        level: "mid",
        mode: "technical",
        durationMinutes: 20,
        consent: { acceptedAt: new Date(), version: INTERVIEW_CONSENT_VERSION },
        questionPlan: ["Question one?"],
        tokenCap: 12000,
        status: "in_progress",
        endsAt: new Date(Date.now() + 60_000),
      });
      assert.ok(await repo.findSession(session._id, owner));
      assert.equal(await repo.findSession(session._id, otherOwner), null);
      await assert.doesNotReject(() =>
        interviewSessionService.assertTranscriptionAllowed(user, session._id.toString()),
      );
      await assert.rejects(
        interviewSessionService.assertTranscriptionAllowed(
          { _id: otherOwner, plan: "premium" },
          session._id.toString(),
        ),
        { statusCode: 404 },
        "a different account cannot create a transcription credential for this interview",
      );

      const claims = await Promise.all([
        repo.claimQuestion(session._id, owner, 0, "claim-one-123"),
        repo.claimQuestion(session._id, owner, 0, "claim-two-123"),
      ]);
      assert.equal(claims.filter(Boolean).length, 1, "only one concurrent answer claim wins");
      await InterviewSession.updateOne(
        { _id: session._id },
        { $set: { activeAnswerClaimExpiresAt: new Date(Date.now() - 1) } },
      );
      assert.ok(await repo.claimQuestion(session._id, owner, 0, "claim-retry-123"));

      await InterviewMessage.create({
        interviewId,
        userId: owner,
        sequence: 0,
        role: "interviewer",
        content: "Question?",
      });
      await assert.rejects(
        InterviewMessage.create({
          interviewId,
          userId: owner,
          sequence: 0,
          role: "interviewer",
          content: "Duplicate?",
        }),
        { code: 11000 },
      );
      const report = { overallScore: 70 };
      await InterviewReport.create({ interviewId, userId: owner, report, schemaVersion: "test" });
      await assert.rejects(
        InterviewReport.create({ interviewId, userId: owner, report, schemaVersion: "test" }),
        { code: 11000 },
      );
      assert.equal(await repo.deleteSession(session._id, otherOwner), false);
      assert.equal(await repo.deleteSession(session._id, owner), true);
    } finally {
      await mongoose.disconnect();
      await server.stop();
    }
  },
);
