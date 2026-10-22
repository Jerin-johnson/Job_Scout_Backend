import { injectable } from "tsyringe";
import {
  IBillingGateway,
  CreateCheckoutParams,
  CheckoutSessionResult,
  WebhookResult,
} from "../../../domain/services/IBillingGateway.js";
import { billingService } from "./billingService.js";

@injectable()
export class BillingGatewayAdapter implements IBillingGateway {
  async createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutSessionResult> {
    return billingService.createCheckoutSession(params);
  }

  async handleRazorpayWebhook(body: unknown, signature?: string): Promise<WebhookResult> {
    return billingService.handleRazorpayWebhook(body, signature);
  }
}
