import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { QuizAttemptModel } from "../src/infrastructure/database/mongoose/models/QuizAttemptModel.js";
import { quizAttemptRepository } from "../src/infrastructure/database/mongoose/repositories/MongooseQuizAttemptRepository.js";

let MongoMemoryServer;
try {
  ({ MongoMemoryServer } = await import("mongodb-memory-server"));
} catch {
  // This integration suite is optional when the local Mongo test dependency is absent.
}

test(
  "quiz attempt history persists answers, is idempotent, owner-scoped, and deletable",
  { skip: !(MongoMemoryServer && process.env.QUIZ_ATTEMPT_MONGO_INTEGRATION === "true") },
  async () => {
    const server = await MongoMemoryServer.create();
    try {
      await mongoose.connect(server.getUri());
      await QuizAttemptModel.syncIndexes();
      const owner = new mongoose.Types.ObjectId();
      const other = new mongoose.Types.ObjectId();
      const quizSessionId = "quiz_session_123456";
      await quizAttemptRepository.create({
        userId: owner,
        quizSessionId,
        stack: "mern",
        promptVersion: "test-v1",
        questionCount: 3,
        questions: ["one", "two", "three"].map((id) => ({
          questionId: id,
          title: `Title ${id}`,
          question: `Question ${id}?`,
          type: "scenario_voice",
          correctAnswerText: "Expected answer",
          explanation: "Explanation",
        })),
      });
      const evaluation = {
        isCorrect: false,
        score: 40,
        pointsEarned: 5,
        feedback: "Review the answer",
        totalPoints: 5,
      };
      const input = {
        userId: owner.toString(),
        quizSessionId,
        questionId: "one",
        userAnswer: "My real submitted answer",
        evaluation,
      };
      const first = await quizAttemptRepository.recordAnswer(input);
      const duplicate = await quizAttemptRepository.recordAnswer(input);
      assert.equal(first.saved, true);
      assert.equal(duplicate.saved, false);
      assert.deepEqual(duplicate.attempt.questions[0].evaluation, evaluation);
      assert.equal(
        await quizAttemptRepository.findQuestion(other.toString(), quizSessionId, "one"),
        null,
      );
      assert.equal(await quizAttemptRepository.delete(other.toString(), quizSessionId), false);
      const detail = await quizAttemptRepository.detail(owner.toString(), quizSessionId);
      assert.equal(detail.questions[0].userAnswer, "My real submitted answer");
      assert.equal(detail.questions[0].correctAnswerText, "Expected answer");
      assert.equal(await quizAttemptRepository.delete(owner.toString(), quizSessionId), true);
      assert.equal(await quizAttemptRepository.detail(owner.toString(), quizSessionId), null);
    } finally {
      await mongoose.disconnect();
      await server.stop();
    }
  },
);
