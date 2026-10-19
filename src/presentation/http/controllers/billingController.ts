import { Request, Response } from "express";
import { billingService } from "../../../services/billingService.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse, errorResponse } from "../../../shared/types/apiResponse.js";
import { checkoutSchema } from "../../../shared/schemas/billingSchemas.js";

export const billingController = {
  /**
   * POST /api/v1/billing/checkout
   */
  checkout: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json(
          errorResponse(
            "VALIDATION_ERROR",
            parsed.error.issues[0].message,
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }

    const session = await billingService.createCheckoutSession({
      user: req.user,
      plan: parsed.data.plan,
    });

    res.status(200).json(successResponse(session));
  }),

  /**
   * POST /api/v1/billing/razorpay-webhook
   */
  razorpayWebhook: asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers["x-razorpay-signature"] as string | undefined;
    const result = await billingService.handleRazorpayWebhook(req.body, signature);

    res.status(200).json({
      received: true,
      ...result,
    });
  }),
};
