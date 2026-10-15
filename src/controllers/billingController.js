import { z } from "zod";
import { billingService } from "../services/billingService.js";
import { PLANS } from "../shared/constants/plans.js";

const CheckoutSchema = z.object({
  plan: z.enum([PLANS.PRO, PLANS.PREMIUM]),
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
      });

      return res.status(200).json({
        data: session,
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
