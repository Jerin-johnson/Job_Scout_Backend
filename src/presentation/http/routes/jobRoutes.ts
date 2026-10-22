import { Router } from "express";
import { JobController } from "../controllers/JobController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { requireQuota } from "../middleware/quotaGate.js";
import { generalApiLimiter } from "../middleware/rateLimiter.js";
import { appContainer } from "../../../main/container.js";

export function createJobRouter(): Router {
  const jobRouter = Router();
  const controller = appContainer.resolve(JobController);

  jobRouter.post(
    "/saved-searches/:id/unsubscribe",
    generalApiLimiter,
    controller.unsubscribeSavedSearch,
  );

  jobRouter.use(authenticate);

  jobRouter.get("/matches", controller.getMatches);
  jobRouter.get("/coverage", controller.coverage);
  jobRouter.get("/matches/refresh", controller.getMatchRefresh);
  jobRouter.get("/matches/debug", controller.getMatchDebug);
  jobRouter.get("/saved-searches", controller.listSavedSearches);
  jobRouter.post(
    "/saved-searches/preview",
    csrfProtection,
    generalApiLimiter,
    controller.previewSavedSearch,
  );
  jobRouter.post(
    "/saved-searches",
    csrfProtection,
    generalApiLimiter,
    controller.createSavedSearch,
  );
  jobRouter.patch(
    "/saved-searches/:id",
    csrfProtection,
    generalApiLimiter,
    controller.updateSavedSearch,
  );
  jobRouter.delete(
    "/saved-searches/:id",
    csrfProtection,
    generalApiLimiter,
    controller.deleteSavedSearch,
  );
  jobRouter.get("/catalog/:id", controller.getJobDetails);
  jobRouter.get("/catalog", controller.searchCatalog);
  jobRouter.post("/companies/track", csrfProtection, generalApiLimiter, controller.trackCompany);
  jobRouter.post("/:id/apply-click", csrfProtection, controller.recordApplyClick);
  jobRouter.post("/:id/hide", csrfProtection, controller.hideJob);
  jobRouter.post("/:id/report", csrfProtection, controller.reportJob);
  jobRouter.post("/discover", csrfProtection, requireQuota("match_jobs"), controller.runDiscovery);
  jobRouter.post("/:id/feedback", csrfProtection, controller.recordFeedback);

  return jobRouter;
}

export const jobRouter = createJobRouter();
