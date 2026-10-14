import { Router } from "express";
import { authController } from "../controllers/authController.js";
import { authenticate } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimiter.js";
import { csrfProtection } from "../middleware/csrf.js";

export const authRouter = Router();

authRouter.post("/register", authLimiter, csrfProtection, authController.register);
authRouter.post("/login", authLimiter, csrfProtection, authController.login);
authRouter.post("/google", authLimiter, csrfProtection, authController.googleAuth);
authRouter.post("/refresh", csrfProtection, authController.refresh);
authRouter.post("/logout", csrfProtection, authController.logout);
authRouter.get("/me", authenticate, authController.me);
