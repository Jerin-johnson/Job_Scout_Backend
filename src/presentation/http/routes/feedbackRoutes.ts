import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { feedbackLimiter } from "../middleware/rateLimiter.js";
import { FeedbackController } from "../controllers/FeedbackController.js";
import { appContainer } from "../../../main/container.js";

export function createFeedbackRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(FeedbackController);
  router.use(authenticate);
  router.post("/", csrfProtection, feedbackLimiter, controller.submit);
  return router;
}

export const feedbackRouter = createFeedbackRouter();
