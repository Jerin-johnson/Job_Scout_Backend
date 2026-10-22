import { Router } from "express";
import { ResumeMatchController } from "../controllers/ResumeMatchController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { generalApiLimiter } from "../middleware/rateLimiter.js";
import { appContainer } from "../../../main/container.js";

export function createResumeMatchRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(ResumeMatchController);

  router.use(authenticate, generalApiLimiter);
  router.post("/reports", csrfProtection, controller.createOrFetch);
  router.get("/reports", controller.list);
  router.get("/reports/:id", controller.get);
  router.patch("/reports/:id/ignored-keywords", csrfProtection, controller.ignoreKeywords);
  router.post("/reports/:id/suggestions", csrfProtection, controller.suggestions);
  router.delete("/reports/:id", csrfProtection, controller.remove);

  return router;
}

export const resumeMatchRouter = createResumeMatchRouter();
