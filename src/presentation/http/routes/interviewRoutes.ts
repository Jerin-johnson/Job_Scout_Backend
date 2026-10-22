import { Router } from "express";
import { interviewController } from "../controllers/interviewController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { requireQuota } from "../middleware/quotaGate.js";
import {
  answerRateLimit,
  completeRateLimit,
  transcriptionSessionRateLimit,
} from "../middleware/interviewRateLimit.js";

export const interviewRouter = Router();

interviewRouter.use(authenticate);

interviewRouter.post(
  "/prep",
  csrfProtection,
  requireQuota("interview_prep"),
  interviewController.prep,
);

interviewRouter.post(
  "/mock/turn",
  csrfProtection,
  requireQuota("mock_interview"),
  interviewController.mockTurn,
);

interviewRouter.get("/modes", interviewController.modes);
interviewRouter.get("/sessions", interviewController.listSessions);
interviewRouter.post("/sessions", csrfProtection, interviewController.createSession);
interviewRouter.post(
  "/sessions/:id/transcription-session",
  csrfProtection,
  transcriptionSessionRateLimit,
  interviewController.createTranscriptionSession,
);
interviewRouter.post("/sessions/:id/start", csrfProtection, interviewController.startSession);
interviewRouter.post(
  "/sessions/:id/answers",
  csrfProtection,
  answerRateLimit,
  interviewController.answer,
);
interviewRouter.post(
  "/sessions/:id/answers/stream",
  csrfProtection,
  answerRateLimit,
  interviewController.answerStream,
);
interviewRouter.post(
  "/sessions/:id/complete",
  csrfProtection,
  completeRateLimit,
  interviewController.completeSession,
);
interviewRouter.patch("/sessions/:id/pin", csrfProtection, interviewController.pinSession);
interviewRouter.get("/sessions/:id/report", interviewController.sessionReport);
interviewRouter.get("/sessions/:id", interviewController.sessionDetail);
interviewRouter.delete("/sessions/:id", csrfProtection, interviewController.deleteSession);

interviewRouter.get("/:id/report", interviewController.getReport);
