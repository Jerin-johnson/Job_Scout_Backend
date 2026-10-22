import { Router } from "express";
import { AdminController } from "../controllers/AdminController.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { ROLES } from "../../../shared/constants/plans.js";
import { csrfProtection } from "../middleware/csrf.js";
import { appContainer } from "../../../main/container.js";

export function createAdminRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(AdminController);

  router.use(authenticate);
  router.use(requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]));

  router.get("/metrics", controller.getMetrics);
  router.get("/users", controller.listUsers);
  router.get("/jobs", controller.listJobs);
  router.get("/jobs/coverage", controller.jobCoverage);
  router.get("/jobs/reports", controller.listJobReports);
  router.get("/jobs/sources", controller.listJobSources);
  router.get("/jobs/companies", controller.listTrackedCompanies);
  router.patch("/jobs/companies/:id", csrfProtection, controller.updateTrackedCompany);
  router.patch("/jobs/sources/:key", csrfProtection, controller.updateJobSource);
  router.get("/audit", controller.listAudit);
  router.patch("/users/:id", csrfProtection, requireRole(ROLES.SUPER_ADMIN), controller.updateUser);
  router.get("/billing/overview", requireRole(ROLES.SUPER_ADMIN), controller.billingOverview);
  router.get(
    "/billing/subscriptions",
    requireRole(ROLES.SUPER_ADMIN),
    controller.listSubscriptions,
  );
  router.post(
    "/billing/subscriptions/:id/cancel",
    csrfProtection,
    requireRole(ROLES.SUPER_ADMIN),
    controller.cancelSubscription,
  );
  router.get("/billing/payments", requireRole(ROLES.SUPER_ADMIN), controller.listPayments);
  router.post(
    "/billing/payments/:paymentId/refund",
    csrfProtection,
    requireRole(ROLES.SUPER_ADMIN),
    controller.refundPayment,
  );

  return router;
}

export const adminRouter = createAdminRouter();
