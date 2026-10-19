import { Router, RequestHandler } from "express";
import { appContainer } from "../../../main/container.js";
import { AuthController } from "../controllers/AuthController.js";
import { authController } from "../../../controllers/authController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { csrfProtection } from "../../../middleware/csrf.js";
import { authLimiter } from "../../../middleware/rateLimiter.js";

export function createAuthRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(AuthController);

  router.post("/register", authLimiter, csrfProtection, controller.register);
  router.post("/login", authLimiter, csrfProtection, controller.login);
  router.post("/google", authLimiter, csrfProtection, authController.googleAuth as RequestHandler);
  router.post("/refresh", csrfProtection, controller.refresh);
  router.post("/logout", csrfProtection, controller.logout);
  router.get("/me", authMiddleware as RequestHandler, authController.me as RequestHandler);

  return router;
}
