import { injectable, inject } from "tsyringe";
import { IHandleRazorpayWebhookUseCase } from "../../interfaces/useCases/billing/IHandleRazorpayWebhookUseCase.js";
import { IBillingGateway, WebhookResult } from "../../../domain/services/IBillingGateway.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

@injectable()
export class HandleRazorpayWebhookUseCase implements IHandleRazorpayWebhookUseCase {
  constructor(@inject(TOKENS.BillingGateway) private readonly billingGateway: IBillingGateway) {}

  async execute(body: unknown, signature?: string): Promise<WebhookResult> {
    return this.billingGateway.handleRazorpayWebhook(body, signature);
  }
}
