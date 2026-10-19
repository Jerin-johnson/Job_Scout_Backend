import { Router } from "express";
import { billingController } from "../../../controllers/billingController.js";
import { authenticate } from "../../../middleware/auth.js";
import { csrfProtection } from "../../../middleware/csrf.js";

export const billingRouter = Router();

// Protected user billing endpoints
billingRouter.post("/checkout", authenticate, csrfProtection, billingController.checkout);

// Razorpay webhook endpoint (signature-verified, no auth/csrf middleware)
billingRouter.post("/razorpay-webhook", billingController.razorpayWebhook);
