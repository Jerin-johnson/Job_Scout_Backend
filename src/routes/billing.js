import { Router } from "express";
import { billingController } from "../controllers/billingController.js";
import { authenticate } from "../middleware/auth.js";
import { csrfProtection } from "../middleware/csrf.js";

export const billingRouter = Router();

// Protected user billing endpoints
billingRouter.post("/checkout", authenticate, csrfProtection, billingController.checkout);

billingRouter.post("/portal", authenticate, csrfProtection, billingController.portal);

// Webhook endpoints (signature-verified, no auth/csrf middleware)
billingRouter.post("/stripe-webhook", billingController.stripeWebhook);
billingRouter.post("/razorpay-webhook", billingController.razorpayWebhook);
