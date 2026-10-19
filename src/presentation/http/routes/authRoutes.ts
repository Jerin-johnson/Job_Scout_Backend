import { Router } from "express";
import { appContainer } from "../../../main/container.js";
import { AuthController } from "../controllers/AuthController.js";

export function createAuthRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(AuthController);

  router.post("/register", controller.register);
  router.post("/login", controller.login);
  router.post("/refresh", controller.refresh);
  router.post("/logout", controller.logout);

  return router;
}
