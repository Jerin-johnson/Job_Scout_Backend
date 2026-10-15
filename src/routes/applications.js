import { Router } from "express";
import { applicationController } from "../controllers/applicationController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";

export const applicationRouter = Router();

applicationRouter.use(authenticate);

applicationRouter.get("/", applicationController.getApplications);
applicationRouter.post("/", csrfProtection, applicationController.createApplication);
applicationRouter.get("/:id", applicationController.getApplicationById);
applicationRouter.patch("/:id", csrfProtection, applicationController.updateApplication);
applicationRouter.patch("/:id/status", csrfProtection, applicationController.updateStatus);
applicationRouter.post(
  "/:id/follow-up/approve",
  csrfProtection,
  applicationController.approveFollowUp,
);
applicationRouter.delete("/:id", csrfProtection, applicationController.deleteApplication);
