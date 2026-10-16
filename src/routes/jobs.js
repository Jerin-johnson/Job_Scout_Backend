import { Router } from "express";
import { jobController } from "../controllers/jobController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { requireQuota } from "../middleware/quotaGate.js";

export const jobRouter = Router();

jobRouter.use(authenticate);

jobRouter.get("/matches", jobController.getMatches);
jobRouter.get("/matches/refresh", jobController.getMatchRefresh);
jobRouter.get("/matches/debug", jobController.getMatchDebug);
jobRouter.get("/catalog/:id", jobController.getJobDetails);
jobRouter.get("/catalog", jobController.searchCatalog);
jobRouter.post("/:id/apply-click", csrfProtection, jobController.recordApplyClick);
jobRouter.post("/:id/hide", csrfProtection, jobController.hideJob);
jobRouter.post("/:id/report", csrfProtection, jobController.reportJob);
jobRouter.post("/discover", csrfProtection, requireQuota("match_jobs"), jobController.runDiscovery);
jobRouter.post("/:id/feedback", csrfProtection, jobController.recordFeedback);
