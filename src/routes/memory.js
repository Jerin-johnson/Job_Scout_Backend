import { Router } from "express";
import { memoryController } from "../controllers/memoryController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";

export const memoryRouter = Router();

memoryRouter.use(authenticate);

memoryRouter.get("/", memoryController.list);
memoryRouter.delete("/:id", csrfProtection, memoryController.delete);
memoryRouter.post("/forget-all", csrfProtection, memoryController.forgetAll);
memoryRouter.post("/toggle-pause", csrfProtection, memoryController.togglePause);
