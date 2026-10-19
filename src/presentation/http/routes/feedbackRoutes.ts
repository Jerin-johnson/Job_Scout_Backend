import { Router } from "express";
import { authenticate } from "../../../middleware/auth.js";
import { csrfProtection } from "../../../middleware/csrf.js";
import { feedbackLimiter } from "../../../middleware/rateLimiter.js";
import { feedbackController } from "../../../controllers/feedbackController.js";

export const feedbackRouter = Router();
feedbackRouter.use(authenticate);
feedbackRouter.post("/", csrfProtection, feedbackLimiter, feedbackController.submit);
