import { WebhookResult } from "../../../../domain/services/IBillingGateway.js";

export interface IHandleRazorpayWebhookUseCase {
  execute(body: unknown, signature?: string): Promise<WebhookResult>;
}
