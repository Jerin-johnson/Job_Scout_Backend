import { Router } from "express";
import { aiController } from "../controllers/aiController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { heavyAiLimiter } from "../middleware/rateLimiter.js";

export const aiRouter = Router();

aiRouter.use(authenticate);

aiRouter.get("/models", aiController.listChatModels);
aiRouter.get("/context", aiController.getChatContext);
aiRouter.patch("/preferred-name", csrfProtection, aiController.updatePreferredName);
aiRouter.post("/route", csrfProtection, aiController.route);
aiRouter.post("/chat", heavyAiLimiter, csrfProtection, aiController.streamChat);
