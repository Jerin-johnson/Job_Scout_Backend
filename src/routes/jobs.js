import { Router } from "express";
import { jobController } from "../controllers/jobController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { requireQuota } from "../middleware/quotaGate.js";

export const jobRouter = Router();

jobRouter.use(authenticate);

jobRouter.get("/matches", jobController.getMatches);
jobRouter.post("/discover", csrfProtection, requireQuota("match_jobs"), jobController.runDiscovery);
jobRouter.post("/:id/feedback", csrfProtection, jobController.recordFeedback);
