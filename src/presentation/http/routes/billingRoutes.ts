import { Router } from "express";
import { BillingController } from "../controllers/BillingController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";
import { appContainer } from "../../../main/container.js";

export function createBillingRouter(): Router {
  const router = Router();
  const controller = appContainer.resolve(BillingController);

  // Protected user billing endpoints
  router.post("/checkout", authenticate, csrfProtection, controller.checkout);

  // Razorpay webhook endpoint (signature-verified, no auth/csrf middleware)
  router.post("/razorpay-webhook", controller.razorpayWebhook);

  return router;
}

export const billingRouter = createBillingRouter();
