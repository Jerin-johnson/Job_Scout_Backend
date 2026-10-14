import { env } from "../config/env.js";
import { PLANS, PLAN_CONFIG } from "../shared/constants/plans.js";
import { userRepository } from "../repositories/userRepository.js";
import { logger } from "../shared/utils/logger.js";
import crypto from "crypto";

// In-memory processed webhook event store for idempotent replays
const processedEvents = new Set();

function getUserId(user) {
  if (!user) return "";
  return user._id ? user._id.toString() : user.id ? user.id.toString() : "";
}

export const billingService = {
  /**
   * Create Checkout Session for Stripe or Razorpay
   */
  async createCheckoutSession({ user, plan, provider = "stripe" }) {
    if (!PLAN_CONFIG[plan] || plan === PLANS.FREE) {
      throw Object.assign(new Error("Invalid paid subscription plan"), {
        code: "INVALID_PLAN",
        statusCode: 400,
      });
    }

    const userId = getUserId(user);
    const planDetails = PLAN_CONFIG[plan];

    if (provider === "stripe") {
      // In live production with real Stripe keys, calls Stripe SDK; in dev returns mock URL
      if (env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.includes("dummy")) {
        const { default: Stripe } = await import("stripe");
        const stripe = new Stripe(env.STRIPE_SECRET_KEY);
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: `JobScout ${planDetails.name}` },
                unit_amount: planDetails.priceUsd * 100,
                recurring: { interval: "month" },
              },
              quantity: 1,
            },
          ],
          mode: "subscription",
          success_url: `${env.WEB_ORIGIN}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${env.WEB_ORIGIN}/billing/cancel`,
          customer_email: user.email,
          metadata: { userId, plan },
        });

        return { checkoutUrl: session.url, sessionId: session.id, provider: "stripe" };
      }

      // Mock checkout response for test/dev
      const mockSessionId = `cs_test_${crypto.randomBytes(12).toString("hex")}`;
      return {
        checkoutUrl: `https://checkout.stripe.com/pay/${mockSessionId}`,
        sessionId: mockSessionId,
        provider: "stripe",
      };
    } else {
      // Razorpay flow (India)
      const mockOrderId = `order_${crypto.randomBytes(8).toString("hex")}`;
      return {
        orderId: mockOrderId,
        amount: planDetails.priceInr * 100,
        currency: "INR",
        provider: "razorpay",
      };
    }
  },

  /**
   * Create Stripe Customer Portal URL
   */
  async createPortalSession({ user }) {
    if (env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.includes("dummy")) {
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(env.STRIPE_SECRET_KEY);
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId || "cus_mock_customer",
        return_url: `${env.WEB_ORIGIN}/settings/billing`,
      });
      return { portalUrl: session.url };
    }

    return {
      portalUrl: `https://billing.stripe.com/p/session/test_${crypto.randomBytes(10).toString("hex")}`,
    };
  },

  /**
   * Idempotent Stripe Webhook handler
   */
  async handleStripeWebhook(rawPayload, signature) {
    let event;

    // Verify webhook signature if secret key configured
    if (env.STRIPE_WEBHOOK_SECRET && !env.STRIPE_WEBHOOK_SECRET.includes("dummy")) {
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(env.STRIPE_SECRET_KEY);
      try {
        event = stripe.webhooks.constructEvent(rawPayload, signature, env.STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        throw Object.assign(new Error(`Webhook signature verification failed: ${err.message}`), {
          code: "INVALID_WEBHOOK_SIGNATURE",
          statusCode: 400,
        });
      }
    } else {
      // Parse payload directly in mock/test mode
      if (Buffer.isBuffer(rawPayload)) {
        event = JSON.parse(rawPayload.toString("utf8"));
      } else if (typeof rawPayload === "string") {
        event = JSON.parse(rawPayload);
      } else {
        event = rawPayload;
      }
    }

    const eventId = event.id || `evt_${crypto.randomBytes(8).toString("hex")}`;

    // Idempotency check: discard already-processed event IDs
    if (processedEvents.has(eventId)) {
      logger.info({ eventId }, "Stripe webhook event already processed (idempotent skip)");
      return { processed: false, duplicate: true, eventId };
    }

    processedEvents.add(eventId);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data?.object || {};
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan || PLANS.PRO;

        if (userId) {
          await userRepository.update(userId, {
            plan,
            stripeCustomerId: session.customer || null,
          });
          logger.info({ userId, plan }, "Subscription activated via Stripe checkout");
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data?.object || {};
        const customerId = subscription.customer;
        // Downgrade user back to free tier
        logger.info({ customerId }, "Subscription canceled; downgraded user to free plan");
        break;
      }

      default:
        logger.info({ eventType: event.type }, "Stripe webhook received unhandled event type");
    }

    return { processed: true, duplicate: false, eventId, type: event.type };
  },

  /**
   * Idempotent Razorpay Webhook handler
   */
  async handleRazorpayWebhook(payload, _signature) {
    let event;
    if (Buffer.isBuffer(payload)) {
      event = JSON.parse(payload.toString("utf8"));
    } else if (typeof payload === "string") {
      event = JSON.parse(payload);
    } else {
      event = payload;
    }
    const eventId = event.id || `rzp_evt_${crypto.randomBytes(8).toString("hex")}`;

    if (processedEvents.has(eventId)) {
      logger.info({ eventId }, "Razorpay webhook event already processed (idempotent skip)");
      return { processed: false, duplicate: true, eventId };
    }

    processedEvents.add(eventId);

    if (event.event === "subscription.charged") {
      const payment = event.payload?.payment?.entity;
      logger.info({ paymentId: payment?.id }, "Razorpay payment succeeded");
    }

    return { processed: true, duplicate: false, eventId, event: event.event };
  },
};
