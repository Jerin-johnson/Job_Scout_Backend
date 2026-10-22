import { Router } from "express";
import { InterviewController } from "../controllers/InterviewController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { requireQuota } from "../middleware/quotaGate.js";
import {
  answerRateLimit,
  completeRateLimit,
  quizSessionRateLimit,
  transcriptionSessionRateLimit,
} from "../middleware/interviewRateLimit.js";
import { appContainer } from "../../../main/container.js";

export function createInterviewRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(InterviewController);

  router.use(authenticate);

  router.post("/prep", csrfProtection, requireQuota("interview_prep"), controller.prep);

  router.post("/mock/turn", csrfProtection, requireQuota("mock_interview"), controller.mockTurn);

  router.get("/modes", controller.modes);
  router.get("/quiz/question", controller.getQuizQuestion);
  router.post("/quiz/session", csrfProtection, quizSessionRateLimit, controller.startQuizSession);
  router.post("/quiz/submit", csrfProtection, answerRateLimit, controller.submitQuizAnswer);
  router.get("/quiz/stats", controller.getQuizStats);
  router.get("/quiz/history", controller.listQuizHistory);
  router.get("/quiz/history/:id", controller.getQuizHistoryDetail);
  router.post(
    "/quiz/history/:id/repractice",
    csrfProtection,
    quizSessionRateLimit,
    controller.repracticeQuizHistory,
  );
  router.delete("/quiz/history/:id", csrfProtection, controller.deleteQuizHistory);
  router.get("/sessions", controller.listSessions);
  router.post("/sessions", csrfProtection, controller.createSession);
  router.post(
    "/sessions/:id/transcription-session",
    csrfProtection,
    transcriptionSessionRateLimit,
    controller.createTranscriptionSession,
  );
  router.post("/sessions/:id/start", csrfProtection, controller.startSession);
  router.post("/sessions/:id/answers", csrfProtection, answerRateLimit, controller.answer);
  router.post(
    "/sessions/:id/answers/stream",
    csrfProtection,
    answerRateLimit,
    controller.answerStream,
  );
  router.post(
    "/sessions/:id/complete",
    csrfProtection,
    completeRateLimit,
    controller.completeSession,
  );
  router.patch("/sessions/:id/pin", csrfProtection, controller.pinSession);
  router.get("/sessions/:id/report", controller.sessionReport);
  router.get("/sessions/:id", controller.sessionDetail);
  router.delete("/sessions/:id", csrfProtection, controller.deleteSession);

  router.get("/:id/report", controller.getReport);

  return router;
}

export const interviewRouter = createInterviewRouter();
