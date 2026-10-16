import { Router } from "express";
import multer from "multer";
import { profileController } from "../controllers/profileController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { generalApiLimiter } from "../middleware/rateLimiter.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

export const profileRouter = Router();

profileRouter.use(authenticate);

profileRouter.post(
  "/resume-upload-url",
  csrfProtection,
  profileController.createResumeUploadUrl,
);
profileRouter.get("/resume-ai-consent", profileController.getResumeAiConsent);
profileRouter.put("/resume-ai-consent", csrfProtection, profileController.acceptResumeAiConsent);
profileRouter.post(
  "/resume-upload-complete",
  csrfProtection,
  profileController.completeResumeUpload,
);
profileRouter.post(
  "/upload-resume",
  csrfProtection,
  upload.single("file"),
  profileController.uploadResume,
);

profileRouter.get("/", profileController.getProfile);
profileRouter.get("/role-suggestions", generalApiLimiter, profileController.roleSuggestions);
profileRouter.get("/place-suggestions", generalApiLimiter, profileController.placeSuggestions);
profileRouter.get("/career-profile", profileController.getCareerProfile);
profileRouter.patch("/career-profile", csrfProtection, profileController.updateCareerProfile);
profileRouter.get("/resumes", profileController.listResumes);
profileRouter.put("/preferences", csrfProtection, profileController.updatePreferences);
profileRouter.patch("/preferences/target-roles", csrfProtection, profileController.confirmTargetRoles);
profileRouter.get("/facts", profileController.getFacts);
