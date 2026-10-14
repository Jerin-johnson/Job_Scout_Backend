import { Router } from "express";
import multer from "multer";
import { profileController } from "../controllers/profileController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

export const profileRouter = Router();

profileRouter.use(authenticate);

profileRouter.post(
  "/upload-resume",
  csrfProtection,
  upload.single("file"),
  profileController.uploadResume,
);

profileRouter.get("/", profileController.getProfile);
profileRouter.put("/preferences", csrfProtection, profileController.updatePreferences);
profileRouter.get("/facts", profileController.getFacts);
