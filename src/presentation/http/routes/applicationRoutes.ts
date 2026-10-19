import { Router, RequestHandler } from "express";
import { appContainer } from "../../../main/container.js";
import { ApplicationController } from "../controllers/ApplicationController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

export function createApplicationRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(ApplicationController);

  router.use(authMiddleware as RequestHandler);
  router.get("/", controller.list as RequestHandler);
  router.post("/", controller.create as RequestHandler);
  router.patch("/:id/status", controller.updateStatus as RequestHandler);

  return router;
}
