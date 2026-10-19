import { Router, RequestHandler } from "express";
import multer from "multer";
import { appContainer } from "../../../main/container.js";
import { ProfileController } from "../controllers/ProfileController.js";
import { profileController } from "../../../controllers/profileController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { csrfProtection } from "../../../middleware/csrf.js";
import { generalApiLimiter } from "../../../middleware/rateLimiter.js";

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
    profileController.createResumeUploadUrl as RequestHandler,
  );
  router.get("/resume-ai-consent", profileController.getResumeAiConsent as RequestHandler);
  router.put(
    "/resume-ai-consent",
    csrfProtection,
    profileController.acceptResumeAiConsent as RequestHandler,
  );
  router.get("/job-analytics-consent", profileController.getJobAnalyticsConsent as RequestHandler);
  router.put(
    "/job-analytics-consent",
    csrfProtection,
    profileController.updateJobAnalyticsConsent as RequestHandler,
  );
  router.post(
    "/resume-upload-complete",
    csrfProtection,
    profileController.completeResumeUpload as RequestHandler,
  );
  router.post(
    "/upload-resume",
    csrfProtection,
    upload.single("file"),
    profileController.uploadResume as RequestHandler,
  );

  // Suggestions & Career Profile
  router.get(
    "/role-suggestions",
    generalApiLimiter,
    profileController.roleSuggestions as RequestHandler,
  );
  router.get(
    "/place-suggestions",
    generalApiLimiter,
    profileController.placeSuggestions as RequestHandler,
  );
  router.get("/career-profile", profileController.getCareerProfile as RequestHandler);
  router.patch(
    "/career-profile",
    csrfProtection,
    profileController.updateCareerProfile as RequestHandler,
  );

  // Resumes Management
  router.get("/resumes", profileController.listResumes as RequestHandler);
  router.delete(
    "/resumes/:id",
    csrfProtection,
    generalApiLimiter,
    profileController.deleteResume as RequestHandler,
  );
  router.post(
    "/resumes/:id/reread",
    csrfProtection,
    generalApiLimiter,
    profileController.rereadResume as RequestHandler,
  );

  // Preferences & Facts
  router.put("/preferences", csrfProtection, profileController.updatePreferences as RequestHandler);
  router.patch(
    "/preferences/target-roles",
    csrfProtection,
    profileController.confirmTargetRoles as RequestHandler,
  );
  router.get("/facts", profileController.getFacts as RequestHandler);

  // Clean Architecture Core Profile Endpoints
  router.get("/", controller.getProfile as RequestHandler);
  router.put("/", controller.upsertProfile as RequestHandler);

  return router;
}
