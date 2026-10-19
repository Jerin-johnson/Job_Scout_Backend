import { Router } from "express";
import { resumeMatchController } from "../controllers/resumeMatchController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { generalApiLimiter } from "../middleware/rateLimiter.js";

export const resumeMatchRouter = Router();
resumeMatchRouter.use(authenticate, generalApiLimiter);
resumeMatchRouter.post("/reports", csrfProtection, resumeMatchController.createOrFetch);
resumeMatchRouter.get("/reports", resumeMatchController.list);
resumeMatchRouter.get("/reports/:id", resumeMatchController.get);
resumeMatchRouter.patch(
  "/reports/:id/ignored-keywords",
  csrfProtection,
  resumeMatchController.ignoreKeywords,
);
resumeMatchRouter.post(
  "/reports/:id/suggestions",
  csrfProtection,
  resumeMatchController.suggestions,
);
resumeMatchRouter.delete("/reports/:id", csrfProtection, resumeMatchController.remove);
