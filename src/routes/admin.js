import { Router } from "express";
import { adminController } from "../controllers/adminController.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { ROLES } from "../shared/constants/plans.js";

export const adminRouter = Router();

adminRouter.use(authenticate);
adminRouter.use(requireRole(ROLES.ADMIN));

adminRouter.get("/metrics", adminController.getMetrics);
