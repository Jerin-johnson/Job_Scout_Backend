import { Router } from "express";
import { TailoringController } from "../controllers/TailoringController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { requireQuota } from "../middleware/quotaGate.js";
import { appContainer } from "../../../main/container.js";

export function createTailorRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(TailoringController);

  router.use(authenticate);

  router.get("/", controller.listTailoringDocs);
  router.post("/start", csrfProtection, requireQuota("tailor_resume"), controller.startTailor);
  router.get("/:id", controller.getTailoringDoc);
  router.post("/:id/approve", csrfProtection, controller.approveTailor);
  router.post("/:id/reject", csrfProtection, controller.rejectTailor);
  router.get("/:id/export", controller.exportDocument);

  return router;
}

export const tailorRouter = createTailorRouter();
