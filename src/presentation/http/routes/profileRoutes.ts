import { Router, RequestHandler } from "express";
import { appContainer } from "../../../main/container.js";
import { ProfileController } from "../controllers/ProfileController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

export function createProfileRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(ProfileController);

  router.use(authMiddleware as RequestHandler);
  router.get("/", controller.getProfile as RequestHandler);
  router.put("/", controller.upsertProfile as RequestHandler);

  return router;
}
