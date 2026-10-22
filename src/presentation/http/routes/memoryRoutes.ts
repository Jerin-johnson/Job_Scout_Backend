import { Router } from "express";
import { MemoryController } from "../controllers/MemoryController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { appContainer } from "../../../main/container.js";

export function createMemoryRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(MemoryController);

  router.use(authenticate);

  router.get("/", controller.list);
  router.get("/consent", controller.getConsent);
  router.put("/consent", csrfProtection, controller.updateConsent);
  router.post("/", csrfProtection, controller.create);
  router.patch("/:id", csrfProtection, controller.update);
  router.delete("/:id", csrfProtection, controller.delete);
  router.delete("/", csrfProtection, controller.forgetAll);
  router.post("/forget-all", csrfProtection, controller.forgetAll);
  router.post("/toggle-pause", csrfProtection, controller.togglePause);

  return router;
}

export const memoryRouter = createMemoryRouter();
