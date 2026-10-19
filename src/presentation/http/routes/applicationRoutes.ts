import { Router, RequestHandler } from "express";
import { appContainer } from "../../../main/container.js";
import { ApplicationController } from "../controllers/ApplicationController.js";
import { applicationController } from "../../../controllers/applicationController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { csrfProtection } from "../../../middleware/csrf.js";

export function createApplicationRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(ApplicationController);

  router.use(authMiddleware as RequestHandler);

  // Clean Architecture Collection Endpoints
  router.get("/", controller.list as RequestHandler);
  router.post("/", csrfProtection, controller.create as RequestHandler);

  // Granular Item Management Endpoints
  router.get("/:id", applicationController.getApplicationById as RequestHandler);
  router.patch("/:id", csrfProtection, applicationController.updateApplication as RequestHandler);
  router.patch("/:id/status", csrfProtection, controller.updateStatus as RequestHandler);
  router.patch(
    "/:id/archive",
    csrfProtection,
    applicationController.archiveApplication as RequestHandler,
  );
  router.post(
    "/:id/follow-up/approve",
    csrfProtection,
    applicationController.approveFollowUp as RequestHandler,
  );
  router.delete("/:id", csrfProtection, applicationController.deleteApplication as RequestHandler);

  return router;
}
