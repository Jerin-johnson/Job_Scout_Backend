import { Router } from "express";
import { privacyController } from "../../../controllers/privacyController.js";
import { authenticate } from "../../../middleware/auth.js";
import { csrfProtection } from "../../../middleware/csrf.js";

export const privacyRouter = Router();

privacyRouter.use(authenticate);

privacyRouter.get("/export", privacyController.exportData);
privacyRouter.delete("/delete-account", csrfProtection, privacyController.deleteAccount);
