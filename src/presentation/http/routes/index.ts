import { Router } from "express";
import { createAuthRouter } from "./authRoutes.js";
import { createApplicationRouter } from "./applicationRoutes.js";
import { createProfileRouter } from "./profileRoutes.js";
import { jobRouter } from "./jobRoutes.js";
import { aiRouter } from "./aiRoutes.js";
import { memoryRouter } from "./memoryRoutes.js";
import { tailorRouter } from "./tailorRoutes.js";
import { interviewRouter } from "./interviewRoutes.js";
import { billingRouter } from "./billingRoutes.js";
import { adminRouter } from "./adminRoutes.js";
import { privacyRouter } from "./privacyRoutes.js";
import { resumeMatchRouter } from "./resumeMatchRoutes.js";
import { feedbackRouter } from "./feedbackRoutes.js";

export function createApiRouter(): Router {
  const router = Router();

  // Clean Architecture presentation routes
  router.use("/auth", createAuthRouter());
  router.use("/applications", createApplicationRouter());
  router.use("/profile", createProfileRouter());

  // Canonical presentation feature routes
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
export * from "./jobRoutes.js";
export * from "./aiRoutes.js";
export * from "./memoryRoutes.js";
export * from "./tailorRoutes.js";
export * from "./interviewRoutes.js";
export * from "./billingRoutes.js";
export * from "./adminRoutes.js";
export * from "./privacyRoutes.js";
export * from "./resumeMatchRoutes.js";
export * from "./feedbackRoutes.js";
export * from "./healthRoutes.js";
