import { Router } from "express";
import { PrivacyController } from "../controllers/PrivacyController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { appContainer } from "../../../main/container.js";

export function createPrivacyRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(PrivacyController);

  router.use(authenticate);

  router.get("/export", controller.exportData);
  router.delete("/delete-account", csrfProtection, controller.deleteAccount);

  return router;
}

export const privacyRouter = createPrivacyRouter();
