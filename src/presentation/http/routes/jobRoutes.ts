import { Router } from "express";
import { jobController } from "../../../controllers/jobController.js";
import { authenticate } from "../../../middleware/auth.js";
import { csrfProtection } from "../../../middleware/csrf.js";
import { requireQuota } from "../../../middleware/quotaGate.js";
import { generalApiLimiter } from "../../../middleware/rateLimiter.js";

export const jobRouter = Router();

jobRouter.post(
  "/saved-searches/:id/unsubscribe",
  generalApiLimiter,
  jobController.unsubscribeSavedSearch,
);

jobRouter.use(authenticate);

jobRouter.get("/matches", jobController.getMatches);
jobRouter.get("/coverage", jobController.coverage);
jobRouter.get("/matches/refresh", jobController.getMatchRefresh);
jobRouter.get("/matches/debug", jobController.getMatchDebug);
jobRouter.get("/saved-searches", jobController.listSavedSearches);
jobRouter.post(
  "/saved-searches/preview",
  csrfProtection,
  generalApiLimiter,
  jobController.previewSavedSearch,
);
jobRouter.post(
  "/saved-searches",
  csrfProtection,
  generalApiLimiter,
  jobController.createSavedSearch,
);
jobRouter.patch(
  "/saved-searches/:id",
  csrfProtection,
  generalApiLimiter,
  jobController.updateSavedSearch,
);
jobRouter.delete(
  "/saved-searches/:id",
  csrfProtection,
  generalApiLimiter,
  jobController.deleteSavedSearch,
);
jobRouter.get("/catalog/:id", jobController.getJobDetails);
jobRouter.get("/catalog", jobController.searchCatalog);
jobRouter.post("/companies/track", csrfProtection, generalApiLimiter, jobController.trackCompany);
jobRouter.post("/:id/apply-click", csrfProtection, jobController.recordApplyClick);
jobRouter.post("/:id/hide", csrfProtection, jobController.hideJob);
jobRouter.post("/:id/report", csrfProtection, jobController.reportJob);
jobRouter.post("/discover", csrfProtection, requireQuota("match_jobs"), jobController.runDiscovery);
jobRouter.post("/:id/feedback", csrfProtection, jobController.recordFeedback);
