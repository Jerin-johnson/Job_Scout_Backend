import { z } from "zod";
import { billingService } from "../services/billingService.js";
import { PLANS } from "../shared/constants/plans.js";

const CheckoutSchema = z.object({
  plan: z.enum([PLANS.PRO, PLANS.PREMIUM]),
  provider: z.enum(["stripe", "razorpay"]).optional().default("stripe"),
});

export const billingController = {
  /**
   * POST /api/v1/billing/checkout
   */
  async checkout(req, res, next) {
    try {
      const parsed = CheckoutSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
            requestId: req.id,
          },
        });
      }

      const session = await billingService.createCheckoutSession({
        user: req.user,
        plan: parsed.data.plan,
        provider: parsed.data.provider,
      });

      return res.status(200).json({
        data: session,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/billing/portal
   */
  async portal(req, res, next) {
    try {
      const result = await billingService.createPortalSession({
        user: req.user,
      });

      return res.status(200).json({
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/billing/stripe-webhook
   */
  async stripeWebhook(req, res, next) {
    try {
      const signature = req.headers["stripe-signature"];
      const result = await billingService.handleStripeWebhook(req.body, signature);

      return res.status(200).json({
        received: true,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/billing/razorpay-webhook
   */
  async razorpayWebhook(req, res, next) {
    try {
      const signature = req.headers["x-razorpay-signature"];
      const result = await billingService.handleRazorpayWebhook(req.body, signature);

      return res.status(200).json({
        received: true,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  },
};
