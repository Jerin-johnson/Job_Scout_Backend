import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { ICreateCheckoutSessionUseCase } from "../../../application/interfaces/useCases/billing/ICreateCheckoutSessionUseCase.js";
import { IHandleRazorpayWebhookUseCase } from "../../../application/interfaces/useCases/billing/IHandleRazorpayWebhookUseCase.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse, errorResponse } from "../../../shared/types/apiResponse.js";
import { checkoutSchema } from "../../../shared/schemas/billingSchemas.js";
import { appContainer } from "../../../main/container.js";

@injectable()
export class BillingController {
  constructor(
    @inject(TOKENS.CreateCheckoutSessionUseCase)
    private readonly createCheckoutSessionUseCase: ICreateCheckoutSessionUseCase,
    @inject(TOKENS.HandleRazorpayWebhookUseCase)
    private readonly handleRazorpayWebhookUseCase: IHandleRazorpayWebhookUseCase,
  ) {}

  /**
   * POST /api/v1/billing/checkout
   */
  checkout = asyncHandler(async (req: Request, res: Response): Promise<void> => {
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

    const session = await this.createCheckoutSessionUseCase.execute({
      user: req.user,
      plan: parsed.data.plan,
    });

    res.status(200).json(successResponse(session));
  });

  /**
   * POST /api/v1/billing/razorpay-webhook
   */
  razorpayWebhook = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers["x-razorpay-signature"] as string | undefined;
    const result = await this.handleRazorpayWebhookUseCase.execute(req.body, signature);

    res.status(200).json({
      received: true,
      ...result,
    });
  });
}

export const billingController = new Proxy({} as BillingController, {
  get(_target, prop) {
    const instance = appContainer.resolve(BillingController);
    const value = (instance as unknown as Record<string, unknown>)[prop as string];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(instance)
      : value;
  },
});
