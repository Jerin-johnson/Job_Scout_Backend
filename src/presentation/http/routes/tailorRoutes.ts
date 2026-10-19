import { Router } from "express";
import {
  startTailor,
  approveTailor,
  rejectTailor,
  getTailoringDoc,
  exportDocument,
  listTailoringDocs,
} from "../controllers/tailoringController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { requireQuota } from "../middleware/quotaGate.js";

export const tailorRouter = Router();

tailorRouter.use(authenticate);

tailorRouter.get("/", listTailoringDocs);
tailorRouter.post("/start", csrfProtection, requireQuota("tailor_resume"), startTailor);
tailorRouter.get("/:id", getTailoringDoc);
tailorRouter.post("/:id/approve", csrfProtection, approveTailor);
tailorRouter.post("/:id/reject", csrfProtection, rejectTailor);
tailorRouter.get("/:id/export", exportDocument);
