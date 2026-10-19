import Razorpay from "razorpay";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { PLANS, PLAN_CONFIG } from "../shared/constants/plans.js";
import { userRepository } from "../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";
import { isMongoReady } from "../config/database.js";
import { Subscription } from "../infrastructure/database/mongoose/models/SubscriptionModel.js";
import { Payment } from "../infrastructure/database/mongoose/models/PaymentModel.js";

function getUserId(user?: unknown): string {
  if (!user || typeof user !== "object") return "";
  const u = user as { _id?: unknown; id?: unknown };
  return String(u._id || u.id || "");
}

interface CustomHttpError extends Error {
  statusCode?: number;
  code?: string;
}

function razorpayClient(): Razorpay {
  if (
    !env.RAZORPAY_KEY_ID ||
    env.RAZORPAY_KEY_ID.includes("dummy") ||
    !env.RAZORPAY_KEY_SECRET ||
    env.RAZORPAY_KEY_SECRET.includes("dummy")
  ) {
    const error: CustomHttpError = new Error(
      "Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to enable checkout",
    );
    error.code = "BILLING_NOT_CONFIGURED";
    error.statusCode = 503;
    throw error;
  }
  return new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
}

export interface CreateCheckoutSessionParams {
  user?: unknown;
  plan: string;
}

export interface CreateCheckoutSessionResult {
  checkoutUrl: string;
  sessionId: string;
  provider: string;
}

export interface RazorpayWebhookResult {
  processed: boolean;
  eventId: string | null;
  event: string;
}

export const billingService = {
  async createCheckoutSession({
    user,
    plan,
  }: CreateCheckoutSessionParams): Promise<CreateCheckoutSessionResult> {
    const validPlan = plan as keyof typeof PLAN_CONFIG;
    if (!PLAN_CONFIG[validPlan] || plan === PLANS.FREE) {
      const error: CustomHttpError = new Error("Invalid paid subscription plan");
      error.code = "INVALID_PLAN";
      error.statusCode = 400;
      throw error;
    }
    const planId = plan === PLANS.PRO ? env.RAZORPAY_PLAN_ID_PRO : env.RAZORPAY_PLAN_ID_PREMIUM;
    if (!planId || planId.includes("dummy")) {
      const error: CustomHttpError = new Error(
        `Configure the Razorpay subscription plan ID for ${plan}`,
      );
      error.code = "BILLING_NOT_CONFIGURED";
      error.statusCode = 503;
      throw error;
    }
    const subscription = await razorpayClient().subscriptions.create({
      plan_id: planId,
      customer_notify: 1,
      total_count: 120,
      quantity: 1,
      notes: { userId: getUserId(user), plan },
    });
    if (!subscription.short_url) throw new Error("Razorpay did not return a checkout URL");
    return {
      checkoutUrl: subscription.short_url,
      sessionId: subscription.id,
      provider: "razorpay",
    };
  },

  async cancelSubscription(subscriptionId: string, atPeriodEnd = true): Promise<unknown> {
    return razorpayClient().subscriptions.cancel(subscriptionId, atPeriodEnd);
  },

  async refundPayment(
    paymentId: string,
    amountMinor: number,
    notes: Record<string, unknown> = {},
  ): Promise<unknown> {
    return razorpayClient().payments.refund(paymentId, {
      amount: amountMinor,
      notes: notes as Record<string, string>,
    });
  },

  async handleRazorpayWebhook(
    payload: unknown,
    signature?: string | null,
  ): Promise<RazorpayWebhookResult> {
    if (!env.RAZORPAY_WEBHOOK_SECRET || env.RAZORPAY_WEBHOOK_SECRET.includes("dummy")) {
      const error: CustomHttpError = new Error("Razorpay webhook secret is not configured");
      error.code = "WEBHOOK_NOT_CONFIGURED";
      error.statusCode = 503;
      throw error;
    }
    const raw = Buffer.isBuffer(payload)
      ? payload
      : Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload));
    const expected = crypto
      .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
      .update(raw)
      .digest("hex");
    const supplied = String(signature || "");
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      const error: CustomHttpError = new Error("Razorpay webhook signature verification failed");
      error.code = "INVALID_WEBHOOK_SIGNATURE";
      error.statusCode = 400;
      throw error;
    }
    const event = JSON.parse(raw.toString("utf8")) as {
      id?: string;
      event: string;
      created_at?: number;
      payload?: {
        subscription?: {
          entity?: {
            id?: string;
            customer_id?: string;
            current_start?: number;
            current_end?: number;
            has_scheduled_changes?: boolean;
            notes?: { userId?: string; plan?: string };
          };
        };
        payment?: {
          entity?: {
            id?: string;
            subscription_id?: string;
            amount?: number | string;
            amount_refunded?: number | string;
            currency?: string;
            created_at?: number;
          };
        };
        refund?: {
          entity?: {
            payment_id?: string;
          };
        };
      };
    };
    const subscription = event.payload?.subscription?.entity;
    const payment = event.payload?.payment?.entity;
    let subscriptionRecord: { userId?: unknown; plan?: string } | null = null;
    if (subscription) {
      const existingRecord =
        isMongoReady() && subscription.id
          ? ((await Subscription.findOne({ subscriptionId: subscription.id }).lean()) as {
              userId?: unknown;
              plan?: string;
              status?: string;
              lastProviderEventAt?: Date;
              cancelAtPeriodEnd?: boolean;
            } | null)
          : null;
      const userId =
        subscription.notes?.userId ||
        (existingRecord?.userId ? String(existingRecord.userId) : undefined);
      const plan = (subscription.notes?.plan || existingRecord?.plan) as
        keyof typeof PLAN_CONFIG | undefined;
      const normalizedStatus = (
        {
          "subscription.activated": "active",
          "subscription.authenticated": "active",
          "subscription.charged": "active",
          "subscription.halted": "past_due",
          "subscription.cancelled": "canceled",
        } as Record<string, string>
      )[event.event];
      const eventAt = event.created_at ? new Date(event.created_at * 1000) : new Date();
      const isCurrentEvent =
        !existingRecord?.lastProviderEventAt || eventAt >= existingRecord.lastProviderEventAt;
      if (isMongoReady() && subscription.id && isCurrentEvent) {
        subscriptionRecord = (await Subscription.findOneAndUpdate(
          { subscriptionId: subscription.id },
          {
            $set: {
              ...(userId ? { userId } : {}),
              ...(plan && PLAN_CONFIG[plan] ? { plan } : {}),
              provider: "razorpay",
              status: normalizedStatus || existingRecord?.status || "incomplete",
              customerId: subscription.customer_id || null,
              ...(subscription.current_start
                ? { currentPeriodStart: new Date(subscription.current_start * 1000) }
                : {}),
              currentPeriodEnd: subscription.current_end
                ? new Date(subscription.current_end * 1000)
                : null,
              cancelAtPeriodEnd:
                event.event === "subscription.cancelled"
                  ? false
                  : Boolean(
                      subscription.has_scheduled_changes || existingRecord?.cancelAtPeriodEnd,
                    ),
              lastProviderEventAt: eventAt,
            },
          },
          {
            upsert: Boolean(userId && plan && PLAN_CONFIG[plan]),
            new: true,
            setDefaultsOnInsert: true,
          },
        ).lean()) as { userId?: unknown; plan?: string } | null;
      }
      if (isCurrentEvent && userId && plan && PLAN_CONFIG[plan] && plan !== PLANS.FREE) {
        if (
          ["subscription.activated", "subscription.charged", "subscription.authenticated"].includes(
            event.event,
          )
        ) {
          await userRepository.update(userId, {
            plan,
            planSource: "razorpay",
            subscriptionProvider: "razorpay",
            subscriptionId: subscription.id,
            subscriptionStatus: normalizedStatus || "active",
          });
        } else if (event.event === "subscription.cancelled") {
          await userRepository.update(userId, {
            plan: PLANS.FREE,
            planSource: "razorpay",
            subscriptionStatus: "canceled",
          });
        } else if (event.event === "subscription.halted") {
          await userRepository.update(userId, { subscriptionStatus: "past_due" });
        }
      }
    }
    if (payment?.id && isMongoReady()) {
      const subscriptionId = payment.subscription_id || subscription?.id || null;
      if (!subscriptionRecord && subscriptionId) {
        subscriptionRecord = (await Subscription.findOne({ subscriptionId }).lean()) as {
          userId?: unknown;
          plan?: string;
        } | null;
      }
      if (event.event === "payment.captured" || event.event === "subscription.charged") {
        await Payment.findOneAndUpdate(
          { providerPaymentId: payment.id },
          {
            $setOnInsert: {
              userId: subscriptionRecord?.userId || null,
              subscriptionId,
              provider: "razorpay",
              providerPaymentId: payment.id,
              providerEventId: event.id || null,
              amountMinor: Number(payment.amount || 0),
              currency: payment.currency || "INR",
              status: "captured",
              paidAt: payment.created_at ? new Date(payment.created_at * 1000) : new Date(),
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
      } else if (event.event === "payment.refunded") {
        const amountRefunded = Number(payment.amount_refunded || payment.amount || 0);
        await Payment.findOneAndUpdate(
          { providerPaymentId: payment.id },
          {
            $set: {
              amountRefundedMinor: amountRefunded,
              status:
                amountRefunded >= Number(payment.amount || 0) ? "refunded" : "partially_refunded",
            },
          },
        );
      }
    }
    if (event.event === "refund.failed" && isMongoReady()) {
      const refund = event.payload?.refund?.entity;
      if (refund?.payment_id) {
        const prior = (await Payment.findOne({ providerPaymentId: refund.payment_id })
          .select("amountRefundedMinor")
          .lean()) as { amountRefundedMinor?: number } | null;
        await Payment.updateOne(
          { providerPaymentId: refund.payment_id, status: "refund_pending" },
          { $set: { status: prior?.amountRefundedMinor ? "partially_refunded" : "captured" } },
        );
      }
    }
    return { processed: true, eventId: event.id || null, event: event.event };
  },
};
