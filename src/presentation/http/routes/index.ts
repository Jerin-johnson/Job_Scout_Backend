import { Router } from "express";
import { createAuthRouter } from "./authRoutes.js";
import { createApplicationRouter } from "./applicationRoutes.js";
import { createProfileRouter } from "./profileRoutes.js";

export function createApiRouter(): Router {
  const router = Router();

  router.use("/auth", createAuthRouter());
  router.use("/applications", createApplicationRouter());
  router.use("/profile", createProfileRouter());

  return router;
}

export * from "./authRoutes.js";
export * from "./applicationRoutes.js";
export * from "./profileRoutes.js";
