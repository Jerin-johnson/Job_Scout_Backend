import { Router } from "express";
import { memoryController } from "../../../controllers/memoryController.js";
import { authenticate } from "../../../middleware/auth.js";
import { csrfProtection } from "../../../middleware/csrf.js";

export const memoryRouter = Router();

memoryRouter.use(authenticate);

memoryRouter.get("/", memoryController.list);
memoryRouter.get("/consent", memoryController.getConsent);
memoryRouter.put("/consent", csrfProtection, memoryController.updateConsent);
memoryRouter.post("/", csrfProtection, memoryController.create);
memoryRouter.patch("/:id", csrfProtection, memoryController.update);
memoryRouter.delete("/:id", csrfProtection, memoryController.delete);
memoryRouter.delete("/", csrfProtection, memoryController.forgetAll);
memoryRouter.post("/forget-all", csrfProtection, memoryController.forgetAll);
memoryRouter.post("/toggle-pause", csrfProtection, memoryController.togglePause);
