import { Router } from "express";
import { createAuthRouter } from "./authRoutes.js";
import { createApplicationRouter } from "./applicationRoutes.js";
import { createProfileRouter } from "./profileRoutes.js";
import { jobRouter } from "../../../routes/jobs.js";
import { aiRouter } from "../../../routes/ai.js";
import { memoryRouter } from "../../../routes/memory.js";
import { tailorRouter } from "../../../routes/tailor.js";
import { interviewRouter } from "../../../routes/interview.js";
import { billingRouter } from "../../../routes/billing.js";
import { adminRouter } from "../../../routes/admin.js";
import { privacyRouter } from "../../../routes/privacy.js";
import { resumeMatchRouter } from "../../../routes/resumeMatch.js";
import { feedbackRouter } from "../../../routes/feedback.js";

export function createApiRouter(): Router {
  const router = Router();

  // Clean Architecture presentation routes
  router.use("/auth", createAuthRouter());
  router.use("/applications", createApplicationRouter());
  router.use("/profile", createProfileRouter());

  // Active feature routes
  router.use("/jobs", jobRouter);
  router.use("/ai", aiRouter);
  router.use("/memories", memoryRouter);
  router.use("/tailor", tailorRouter);
  router.use("/interview", interviewRouter);
  router.use("/billing", billingRouter);
  router.use("/admin", adminRouter);
  router.use("/privacy", privacyRouter);
  router.use("/resume-match", resumeMatchRouter);
  router.use("/feedback", feedbackRouter);

  return router;
}

export * from "./authRoutes.js";
export * from "./applicationRoutes.js";
export * from "./profileRoutes.js";
