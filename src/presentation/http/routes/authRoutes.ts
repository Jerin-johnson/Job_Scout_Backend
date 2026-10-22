import { Router, RequestHandler } from "express";
import { appContainer } from "../../../main/container.js";
import { AuthController } from "../controllers/AuthController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { csrfProtection } from "../middleware/csrf.js";
import { authLimiter } from "../middleware/rateLimiter.js";

export function createAuthRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(AuthController);

  router.post("/register", authLimiter, csrfProtection, controller.register as RequestHandler);
  router.post("/verify-otp", authLimiter, csrfProtection, controller.verifyOtp as RequestHandler);
  router.post("/resend-otp", authLimiter, csrfProtection, controller.resendOtp as RequestHandler);
  router.post("/login", authLimiter, csrfProtection, controller.login as RequestHandler);
  router.post("/google", authLimiter, csrfProtection, controller.googleAuth as RequestHandler);
  router.post("/refresh", csrfProtection, controller.refresh as RequestHandler);
  router.post("/logout", csrfProtection, controller.logout as RequestHandler);
  router.get("/me", authMiddleware as RequestHandler, controller.me as RequestHandler);

  return router;
}
