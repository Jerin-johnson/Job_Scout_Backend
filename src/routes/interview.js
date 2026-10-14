import { Router } from "express";
import { interviewController } from "../controllers/interviewController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { requireQuota } from "../middleware/quotaGate.js";

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

interviewRouter.get("/:id/report", interviewController.getReport);
