import Razorpay from "razorpay";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { PLANS, PLAN_CONFIG } from "../shared/constants/plans.js";
import { userRepository } from "../repositories/userRepository.js";
import { isMongoReady } from "../config/database.js";
import { Subscription } from "../models/Subscription.js";
import { Payment } from "../models/Payment.js";

function getUserId(user) {
  return String(user?._id || user?.id || "");
}

function razorpayClient() {
  if (
    !env.RAZORPAY_KEY_ID ||
    env.RAZORPAY_KEY_ID.includes("dummy") ||
    !env.RAZORPAY_KEY_SECRET ||
    env.RAZORPAY_KEY_SECRET.includes("dummy")
  ) {
    throw Object.assign(
      new Error("Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to enable checkout"),
      { code: "BILLING_NOT_CONFIGURED", statusCode: 503 },
    );
  }
  return new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
}

export const billingService = {
  async createCheckoutSession({ user, plan }) {
    if (!PLAN_CONFIG[plan] || plan === PLANS.FREE)
      throw Object.assign(new Error("Invalid paid subscription plan"), {
        code: "INVALID_PLAN",
        statusCode: 400,
      });
    const planId = plan === PLANS.PRO ? env.RAZORPAY_PLAN_ID_PRO : env.RAZORPAY_PLAN_ID_PREMIUM;
    if (!planId || planId.includes("dummy"))
      throw Object.assign(new Error(`Configure the Razorpay subscription plan ID for ${plan}`), {
        code: "BILLING_NOT_CONFIGURED",
        statusCode: 503,
      });
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

  async cancelSubscription(subscriptionId, atPeriodEnd = true) {
    return razorpayClient().subscriptions.cancel(subscriptionId, atPeriodEnd);
  },

  async refundPayment(paymentId, amountMinor, notes = {}) {
    return razorpayClient().payments.refund(paymentId, { amount: amountMinor, notes });
  },

  async handleRazorpayWebhook(payload, signature) {
    if (!env.RAZORPAY_WEBHOOK_SECRET || env.RAZORPAY_WEBHOOK_SECRET.includes("dummy")) {
      throw Object.assign(new Error("Razorpay webhook secret is not configured"), {
        code: "WEBHOOK_NOT_CONFIGURED",
        statusCode: 503,
      });
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
      throw Object.assign(new Error("Razorpay webhook signature verification failed"), {
        code: "INVALID_WEBHOOK_SIGNATURE",
        statusCode: 400,
      });
    }
    const event = JSON.parse(raw.toString("utf8"));
    const subscription = event.payload?.subscription?.entity;
    const payment = event.payload?.payment?.entity;
    let subscriptionRecord = null;
    if (subscription) {
      const existingRecord =
        isMongoReady() && subscription.id
          ? await Subscription.findOne({ subscriptionId: subscription.id }).lean()
          : null;
      const userId = subscription.notes?.userId || existingRecord?.userId?.toString();
      const plan = subscription.notes?.plan || existingRecord?.plan;
      const normalizedStatus = {
        "subscription.activated": "active",
        "subscription.authenticated": "active",
        "subscription.charged": "active",
        "subscription.halted": "past_due",
        "subscription.cancelled": "canceled",
      }[event.event];
      const eventAt = event.created_at ? new Date(event.created_at * 1000) : new Date();
      const isCurrentEvent =
        !existingRecord?.lastProviderEventAt || eventAt >= existingRecord.lastProviderEventAt;
      if (isMongoReady() && subscription.id && isCurrentEvent) {
        subscriptionRecord = await Subscription.findOneAndUpdate(
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
          { upsert: Boolean(userId && PLAN_CONFIG[plan]), new: true, setDefaultsOnInsert: true },
        ).lean();
      }
      if (isCurrentEvent && userId && PLAN_CONFIG[plan] && plan !== PLANS.FREE) {
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
        subscriptionRecord = await Subscription.findOne({ subscriptionId }).lean();
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
        const prior = await Payment.findOne({ providerPaymentId: refund.payment_id })
          .select("amountRefundedMinor")
          .lean();
        await Payment.updateOne(
          { providerPaymentId: refund.payment_id, status: "refund_pending" },
          { $set: { status: prior?.amountRefundedMinor ? "partially_refunded" : "captured" } },
        );
      }
    }
    return { processed: true, eventId: event.id || null, event: event.event };
  },
};
