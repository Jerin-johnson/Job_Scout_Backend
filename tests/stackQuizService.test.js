import test from "node:test";
import assert from "node:assert/strict";
import { stackQuizService } from "../src/infrastructure/interview/stackQuizService.js";

test("quiz service has no generic single-question entry point", () => {
  assert.equal(stackQuizService.getQuestionForUser, undefined);
});

test("quiz answers cannot bypass a personalized session", async () => {
  await assert.rejects(
    stackQuizService.submitAnswer({
      userId: "test_user_quiz_eval",
      questionId: "question_without_session",
      userAnswer: "",
    }),
    (error) => error.code === "QUIZ_SESSION_REQUIRED",
  );
});
