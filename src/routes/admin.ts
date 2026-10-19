import { Router } from "express";
import { adminController } from "../controllers/adminController.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { ROLES } from "../shared/constants/plans.js";
import { csrfProtection } from "../middleware/csrf.js";

export const adminRouter = Router();

adminRouter.use(authenticate);
adminRouter.use(requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]));

adminRouter.get("/metrics", adminController.getMetrics);
adminRouter.get("/users", adminController.listUsers);
adminRouter.get("/jobs", adminController.listJobs);
adminRouter.get("/jobs/coverage", adminController.jobCoverage);
adminRouter.get("/jobs/reports", adminController.listJobReports);
adminRouter.get("/jobs/sources", adminController.listJobSources);
adminRouter.get("/jobs/companies", adminController.listTrackedCompanies);
adminRouter.patch("/jobs/companies/:id", csrfProtection, adminController.updateTrackedCompany);
adminRouter.patch("/jobs/sources/:key", csrfProtection, adminController.updateJobSource);
adminRouter.get("/audit", adminController.listAudit);
adminRouter.patch(
  "/users/:id",
  csrfProtection,
  requireRole(ROLES.SUPER_ADMIN),
  adminController.updateUser,
);
adminRouter.get(
  "/billing/overview",
  requireRole(ROLES.SUPER_ADMIN),
  adminController.billingOverview,
);
adminRouter.get(
  "/billing/subscriptions",
  requireRole(ROLES.SUPER_ADMIN),
  adminController.listSubscriptions,
);
adminRouter.post(
  "/billing/subscriptions/:id/cancel",
  csrfProtection,
  requireRole(ROLES.SUPER_ADMIN),
  adminController.cancelSubscription,
);
adminRouter.get("/billing/payments", requireRole(ROLES.SUPER_ADMIN), adminController.listPayments);
adminRouter.post(
  "/billing/payments/:paymentId/refund",
  csrfProtection,
  requireRole(ROLES.SUPER_ADMIN),
  adminController.refundPayment,
);
