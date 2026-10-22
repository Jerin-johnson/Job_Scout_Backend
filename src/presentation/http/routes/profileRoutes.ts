import { Router, RequestHandler } from "express";
import multer from "multer";
import { appContainer } from "../../../main/container.js";
import { ProfileController } from "../controllers/ProfileController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { csrfProtection } from "../middleware/csrf.js";
import { generalApiLimiter } from "../middleware/rateLimiter.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

export function createProfileRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(ProfileController);

  router.use(authMiddleware as RequestHandler);

  // Resume Upload & AI Consent
  router.post(
    "/resume-upload-url",
    csrfProtection,
    controller.createResumeUploadUrl as RequestHandler,
  );
  router.get("/resume-ai-consent", controller.getResumeAiConsent as RequestHandler);
  router.put(
    "/resume-ai-consent",
    csrfProtection,
    controller.acceptResumeAiConsent as RequestHandler,
  );
  router.get("/job-analytics-consent", controller.getJobAnalyticsConsent as RequestHandler);
  router.put(
    "/job-analytics-consent",
    csrfProtection,
    controller.updateJobAnalyticsConsent as RequestHandler,
  );
  router.post(
    "/resume-upload-complete",
    csrfProtection,
    controller.completeResumeUpload as RequestHandler,
  );
  router.post(
    "/upload-resume",
    csrfProtection,
    upload.single("file"),
    controller.uploadResume as RequestHandler,
  );

  // Suggestions & Career Profile
  router.get("/role-suggestions", generalApiLimiter, controller.roleSuggestions as RequestHandler);
  router.get(
    "/place-suggestions",
    generalApiLimiter,
    controller.placeSuggestions as RequestHandler,
  );
  router.get("/career-profile", controller.getCareerProfile as RequestHandler);
  router.patch("/career-profile", csrfProtection, controller.updateCareerProfile as RequestHandler);

  // Resumes Management
  router.get("/resumes", controller.listResumes as RequestHandler);
  router.delete(
    "/resumes/:id",
    csrfProtection,
    generalApiLimiter,
    controller.deleteResume as RequestHandler,
  );
  router.post(
    "/resumes/:id/reread",
    csrfProtection,
    generalApiLimiter,
    controller.rereadResume as RequestHandler,
  );

  // Preferences & Facts
  router.put("/preferences", csrfProtection, controller.updatePreferences as RequestHandler);
  router.patch(
    "/preferences/target-roles",
    csrfProtection,
    controller.confirmTargetRoles as RequestHandler,
  );
  router.get("/facts", controller.getFacts as RequestHandler);

  // Clean Architecture Core Profile Endpoints
  router.get("/", controller.getProfile as RequestHandler);
  router.put("/", controller.upsertProfile as RequestHandler);

  return router;
}
