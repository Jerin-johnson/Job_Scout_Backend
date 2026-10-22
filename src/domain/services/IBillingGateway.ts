export interface CreateCheckoutParams {
  user?: unknown;
  plan: string;
}

export interface CheckoutSessionResult {
  checkoutUrl: string;
  sessionId: string;
  provider: string;
}

export interface WebhookResult {
  received?: boolean;
  processed: boolean;
  event?: string;
  subscriptionId?: string;
  status?: string;
  eventId?: string | null;
}

export interface IBillingGateway {
  createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutSessionResult>;
  handleRazorpayWebhook(body: unknown, signature?: string): Promise<WebhookResult>;
}
