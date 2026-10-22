import { Router } from "express";
import { AiController } from "../controllers/AiController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { heavyAiLimiter } from "../middleware/rateLimiter.js";
import { appContainer } from "../../../main/container.js";

export function createAiRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(AiController);

  router.use(authenticate);

  router.get("/models", controller.listChatModels);
  router.get("/context", controller.getChatContext);
  router.patch("/preferred-name", csrfProtection, controller.updatePreferredName);
  router.post("/route", csrfProtection, controller.route);
  router.post("/chat", heavyAiLimiter, csrfProtection, controller.streamChat);

  // Chat sessions and persistence
  router.get("/sessions", controller.listSessions);
  router.get("/sessions/:id", controller.getSession);
  router.patch("/sessions/:id", csrfProtection, controller.renameSession);
  router.delete("/sessions/:id", csrfProtection, controller.deleteSession);

  // Propose-and-confirm action verification
  router.post("/actions/confirm", csrfProtection, controller.confirmAction);

  return router;
}

export const aiRouter = createAiRouter();
