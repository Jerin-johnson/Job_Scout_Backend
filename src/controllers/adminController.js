import { getCacheMetrics } from "../shared/cache.js";
import { isMongoReady } from "../config/database.js";
import { isRedisReady } from "../config/redis.js";
import { RoutingLog } from "../models/RoutingLog.js";
import { UsageEvent } from "../models/UsageEvent.js";
import { User } from "../models/User.js";
import { Job } from "../models/Job.js";
import { AuditLog } from "../models/AuditLog.js";
import { Subscription } from "../models/Subscription.js";
import { Payment } from "../models/Payment.js";
import { jobIngestionService } from "../services/jobs/jobIngestionService.js";
import { logger } from "../shared/utils/logger.js";
import { PLANS, ROLES } from "../shared/constants/plans.js";
import { z } from "zod";
import mongoose from "mongoose";
import { billingService } from "../services/billingService.js";

async function audit(req, action, metadata = {}) {
  if (!isMongoReady()) return;
  await AuditLog.create({
    userId: req.user._id,
    action,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    metadata,
  }).catch((err) => logger.error({ err: err.message, action }, "Failed to write admin audit log"));
}

export const adminController = {
  /**
   * GET /api/v1/admin/metrics
   * Returns system telemetry, router tier distribution, and cost guardrail status
   */
  async getMetrics(req, res, next) {
    try {
      const cacheMetrics = getCacheMetrics();

      let tierDistribution = {
        tier0: 0,
        tier1: 0,
        tier2: 0,
        tier0Percentage: 0,
        tier1Percentage: 0,
        tier2Percentage: 0,
      };
      let todayCostUsd = 0;

      if (isMongoReady()) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        // Aggregate routing logs by tier
        const logs = await RoutingLog.aggregate([
          { $match: { createdAt: { $gte: startOfDay } } },
          { $group: { _id: "$tier", count: { $sum: 1 } } },
        ]);

        const counts = { 0: 0, 1: 0, 2: 0 };
        for (const l of logs) {
          counts[l._id] = l.count;
        }

        const total = counts[0] + counts[1] + counts[2];
        if (total > 0) {
          tierDistribution = {
            tier0: counts[0],
            tier1: counts[1],
            tier2: counts[2],
            tier0Percentage: Number(((counts[0] / total) * 100).toFixed(1)),
            tier1Percentage: Number(((counts[1] / total) * 100).toFixed(1)),
            tier2Percentage: Number(((counts[2] / total) * 100).toFixed(1)),
          };
        }

        // Aggregate daily spend
        const spend = await UsageEvent.aggregate([
          { $match: { createdAt: { $gte: startOfDay } } },
          { $group: { _id: null, totalCost: { $sum: "$costUsd" } } },
        ]);
        if (spend.length > 0) {
          todayCostUsd = Number(spend[0].totalCost.toFixed(4));
        }
      }

      const [userCount, jobCount] = isMongoReady()
        ? await Promise.all([
            User.countDocuments({ isDeleted: false }),
            Job.countDocuments({ expiresAt: { $gt: new Date() } }),
          ])
        : [null, null];
      await audit(req, "admin.metrics.read");
      return res.status(200).json({
        data: {
          uptimeSeconds: Math.round(process.uptime()),
          status: isMongoReady() && isRedisReady() ? "healthy" : "degraded",
          totals: { users: userCount, jobs: jobCount },
          dependencies: {
            mongo: isMongoReady() ? "connected" : "offline_fallback",
            redis: isRedisReady() ? "connected" : "in_memory_fallback",
          },
          cache: {
            ...cacheMetrics,
            hitRate:
              cacheMetrics.hits + cacheMetrics.misses > 0
                ? Number(
                    ((cacheMetrics.hits / (cacheMetrics.hits + cacheMetrics.misses)) * 100).toFixed(
                      1,
                    ),
                  )
                : 0.0,
          },
          aiRouter: {
            ...tierDistribution,
            meetsTarget:
              tierDistribution.tier0Percentage + tierDistribution.tier1Percentage >= 70.0,
          },
          costTelemetry: {
            todayCostUsd,
            dailyBudgetCapUsd: Number(process.env.GLOBAL_DAILY_USD_CAP || 500),
            spendRatioPercent: Number(
              ((todayCostUsd / Number(process.env.GLOBAL_DAILY_USD_CAP || 500)) * 100).toFixed(2),
            ),
          },
          queues: {
            ingestJobs: { depth: null, status: "not_configured" },
            dailyMatch: { depth: null, status: "not_configured" },
            sendEmailDigest: { depth: null, status: "not_configured" },
            sendFollowUp: { depth: null, status: "not_configured" },
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async listUsers(req, res, next) {
    try {
      if (!isMongoReady())
        return res.status(503).json({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "User directory requires MongoDB",
            requestId: req.id,
          },
        });
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
      const q = String(req.query.q || "").trim();
      const filter = { isDeleted: false };
      if (q)
        filter.$or = [
          { email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
          { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        ];
      const [users, total] = await Promise.all([
        User.find(filter)
          .select(
            "name email role plan planSource subscriptionProvider subscriptionStatus subscriptionId createdAt",
          )
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        User.countDocuments(filter),
      ]);
      await audit(req, "admin.users.list", { page, limit, query: Boolean(q) });
      res
        .status(200)
        .json({ data: { users, total, page, limit, pages: Math.ceil(total / limit) } });
    } catch (err) {
      next(err);
    }
  },

  async updateUser(req, res, next) {
    try {
      if (!isMongoReady())
        return res.status(503).json({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "User management requires MongoDB",
            requestId: req.id,
          },
        });
      const schema = z
        .object({
          plan: z.enum(Object.values(PLANS)).optional(),
          role: z.enum(Object.values(ROLES)).optional(),
        })
        .refine((value) => value.plan || value.role, "Provide a role or plan update");
      const parsed = schema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0].message,
            requestId: req.id,
          },
        });
      if (!mongoose.isValidObjectId(req.params.id))
        return res
          .status(404)
          .json({ error: { code: "NOT_FOUND", message: "User not found", requestId: req.id } });
      const target = await User.findOne({ _id: req.params.id, isDeleted: false }).lean();
      if (!target)
        return res
          .status(404)
          .json({ error: { code: "NOT_FOUND", message: "User not found", requestId: req.id } });
      if (
        target._id.toString() === req.user._id.toString() &&
        parsed.data.role &&
        parsed.data.role !== ROLES.SUPER_ADMIN
      ) {
        return res.status(409).json({
          error: {
            code: "SELF_DEMOTION_BLOCKED",
            message: "You cannot remove your own super administrator access",
            requestId: req.id,
          },
        });
      }
      if (
        target.role === ROLES.SUPER_ADMIN &&
        parsed.data.role &&
        parsed.data.role !== ROLES.SUPER_ADMIN
      ) {
        const superAdminCount = await User.countDocuments({
          role: ROLES.SUPER_ADMIN,
          isDeleted: false,
        });
        if (superAdminCount <= 1)
          return res.status(409).json({
            error: {
              code: "LAST_SUPER_ADMIN",
              message: "At least one super administrator must remain",
              requestId: req.id,
            },
          });
      }
      if (
        parsed.data.plan &&
        parsed.data.plan !== target.plan &&
        target.subscriptionProvider === "razorpay" &&
        ["active", "past_due"].includes(target.subscriptionStatus)
      ) {
        return res.status(409).json({
          error: {
            code: "ACTIVE_PROVIDER_SUBSCRIPTION",
            message:
              "This user has an active or past-due Razorpay subscription. Change or cancel it in Razorpay before applying a manual plan override.",
            requestId: req.id,
          },
        });
      }
      const updates = { ...parsed.data };
      if (parsed.data.plan) {
        updates.planSource = "admin";
        updates.planVersion = (target.planVersion || 0) + 1;
        if (
          parsed.data.plan === PLANS.FREE &&
          !(target.subscriptionProvider === "razorpay" && target.subscriptionStatus === "active")
        ) {
          updates.subscriptionStatus = null;
          updates.subscriptionId = null;
          updates.subscriptionProvider = null;
        }
      }
      const updated = await User.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true })
        .select(
          "name email role plan planSource subscriptionProvider subscriptionStatus subscriptionId createdAt",
        )
        .lean();
      await audit(req, "admin.user.update", {
        targetUserId: target._id.toString(),
        changes: parsed.data,
      });
      return res.status(200).json({ data: { user: updated } });
    } catch (err) {
      next(err);
    }
  },

  async billingOverview(req, res, next) {
    try {
      if (!isMongoReady())
        return res.status(503).json({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Billing reports require MongoDB",
            requestId: req.id,
          },
        });
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - 30);
      const [
        revenue,
        totalPayments,
        activeSubscriptions,
        pastDueSubscriptions,
        scheduledCancellations,
        subscriptionsByPlan,
        paymentsByStatus,
      ] = await Promise.all([
        Payment.aggregate([
          {
            $match: {
              paidAt: { $gte: since },
              status: { $in: ["captured", "partially_refunded", "refund_pending", "refunded"] },
            },
          },
          {
            $group: {
              _id: "$currency",
              grossMinor: { $sum: "$amountMinor" },
              refundsMinor: { $sum: "$amountRefundedMinor" },
              transactions: { $sum: 1 },
            },
          },
          {
            $project: {
              currency: "$_id",
              grossMinor: 1,
              refundsMinor: 1,
              netMinor: { $subtract: ["$grossMinor", "$refundsMinor"] },
              transactions: 1,
              _id: 0,
            },
          },
        ]),
        Payment.countDocuments(),
        User.countDocuments({
          isDeleted: false,
          subscriptionProvider: "razorpay",
          subscriptionStatus: "active",
        }),
        User.countDocuments({
          isDeleted: false,
          subscriptionProvider: "razorpay",
          subscriptionStatus: "past_due",
        }),
        Subscription.countDocuments({
          provider: "razorpay",
          status: "active",
          cancelAtPeriodEnd: true,
        }),
        User.aggregate([
          { $match: { isDeleted: false } },
          { $group: { _id: "$plan", count: { $sum: 1 } } },
        ]),
        Payment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      ]);
      await audit(req, "admin.billing.overview.read");
      return res.status(200).json({
        data: {
          windowDays: 30,
          revenue,
          totalPayments,
          activeSubscriptions,
          pastDueSubscriptions,
          scheduledCancellations,
          subscriptionsByPlan: Object.fromEntries(
            subscriptionsByPlan.map((item) => [item._id, item.count]),
          ),
          paymentsByStatus: Object.fromEntries(
            paymentsByStatus.map((item) => [item._id, item.count]),
          ),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async listSubscriptions(req, res, next) {
    try {
      if (!isMongoReady())
        return res.status(503).json({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Subscription records require MongoDB",
            requestId: req.id,
          },
        });
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
      const subscriptions = await Subscription.find()
        .populate("userId", "name email")
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();
      await audit(req, "admin.billing.subscriptions.list", { limit });
      return res.status(200).json({ data: { subscriptions } });
    } catch (err) {
      next(err);
    }
  },

  async cancelSubscription(req, res, next) {
    try {
      if (!isMongoReady())
        return res.status(503).json({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Subscription records require MongoDB",
            requestId: req.id,
          },
        });
      if (!mongoose.isValidObjectId(req.params.id))
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Subscription not found", requestId: req.id },
        });
      const subscription = await Subscription.findById(req.params.id);
      if (!subscription)
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Subscription not found", requestId: req.id },
        });
      if (subscription.provider !== "razorpay" || subscription.status !== "active")
        return res.status(409).json({
          error: {
            code: "SUBSCRIPTION_NOT_ACTIVE",
            message: "Only active Razorpay subscriptions can be cancelled",
            requestId: req.id,
          },
        });
      if (subscription.cancelAtPeriodEnd)
        return res.status(409).json({
          error: {
            code: "CANCELLATION_ALREADY_SCHEDULED",
            message: "Cancellation is already scheduled",
            requestId: req.id,
          },
        });
      const result = await billingService.cancelSubscription(subscription.subscriptionId, true);
      subscription.cancelAtPeriodEnd = true;
      await subscription.save();
      await audit(req, "admin.billing.subscription.cancel_scheduled", {
        subscriptionId: subscription.subscriptionId,
        userId: String(subscription.userId),
      });
      return res.status(200).json({
        data: {
          message: "Subscription cancellation scheduled for the end of the billing period",
          subscription: result,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async listPayments(req, res, next) {
    try {
      if (!isMongoReady())
        return res.status(503).json({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Payment records require MongoDB",
            requestId: req.id,
          },
        });
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
      const [payments, total] = await Promise.all([
        Payment.find()
          .populate("userId", "name email")
          .sort({ paidAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Payment.countDocuments(),
      ]);
      await audit(req, "admin.billing.payments.list", { page, limit });
      return res
        .status(200)
        .json({ data: { payments, total, page, limit, pages: Math.ceil(total / limit) } });
    } catch (err) {
      next(err);
    }
  },

  async refundPayment(req, res, next) {
    let payment;
    let previousStatus;
    try {
      if (!isMongoReady())
        return res.status(503).json({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Payment records require MongoDB",
            requestId: req.id,
          },
        });
      payment = await Payment.findOne({ providerPaymentId: req.params.paymentId });
      if (!payment)
        return res
          .status(404)
          .json({ error: { code: "NOT_FOUND", message: "Payment not found", requestId: req.id } });
      if (!["captured", "partially_refunded"].includes(payment.status))
        return res.status(409).json({
          error: {
            code: "PAYMENT_NOT_REFUNDABLE",
            message: "Payment is not currently refundable",
            requestId: req.id,
          },
        });
      const remaining = payment.amountMinor - payment.amountRefundedMinor;
      if (remaining <= 0)
        return res.status(409).json({
          error: {
            code: "PAYMENT_ALREADY_REFUNDED",
            message: "No refundable balance remains",
            requestId: req.id,
          },
        });
      previousStatus = payment.status;
      const claimed = await Payment.findOneAndUpdate(
        {
          _id: payment._id,
          status: previousStatus,
          amountRefundedMinor: payment.amountRefundedMinor,
        },
        { $set: { status: "refund_pending" } },
        { new: true },
      );
      if (!claimed)
        return res.status(409).json({
          error: {
            code: "REFUND_ALREADY_IN_PROGRESS",
            message: "Another refund request is already in progress",
            requestId: req.id,
          },
        });
      const refund = await billingService.refundPayment(payment.providerPaymentId, remaining, {
        initiated_by: "super_admin",
        admin_user_id: String(req.user._id),
      });
      await audit(req, "admin.billing.payment.refund_requested", {
        paymentId: payment.providerPaymentId,
        amountMinor: remaining,
        refundId: refund.id,
      });
      return res.status(202).json({
        data: {
          message:
            "Refund requested from Razorpay; the ledger will update when its webhook arrives",
          refundId: refund.id,
        },
      });
    } catch (err) {
      if (payment && previousStatus)
        await Payment.updateOne(
          { _id: payment._id, status: "refund_pending" },
          { $set: { status: previousStatus } },
        );
      next(err);
    }
  },

  async listJobs(req, res, next) {
    try {
      const result = await jobIngestionService.searchJobs({
        q: String(req.query.q || "").trim(),
        source: String(req.query.source || "").trim(),
        page: Math.max(1, Number.parseInt(req.query.page, 10) || 1),
        limit: Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25)),
      });
      await audit(req, "admin.jobs.list", { page: result.page });
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async listAudit(req, res, next) {
    try {
      if (!isMongoReady())
        return res.status(503).json({
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Admin audit history requires MongoDB",
            requestId: req.id,
          },
        });
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
      const [events, total] = await Promise.all([
        AuditLog.find()
          .populate("userId", "name email")
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        AuditLog.countDocuments(),
      ]);
      res
        .status(200)
        .json({ data: { events, total, page, limit, pages: Math.ceil(total / limit) } });
    } catch (err) {
      next(err);
    }
  },

  async ingestJobs(req, res, next) {
    try {
      const result = await jobIngestionService.ingestAll();
      await audit(req, "admin.jobs.ingest", {
        ingested: result.ingested,
        embedded: result.embedded,
      });
      res.status(200).json({
        data: {
          ingested: result.ingested,
          embedded: result.embedded,
          sources: result.sources || [],
          results: result.results || [],
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async listJobSources(req, res, next) {
    try {
      const sources = await jobIngestionService.sourceBudgets();
      res.status(200).json({ data: { sources } });
    } catch (err) {
      next(err);
    }
  },

  async updateJobSource(req, res, next) {
    try {
      const enabled = z.object({ enabled: z.boolean() }).parse(req.body).enabled;
      const sources = await jobIngestionService.setSourceEnabled(req.params.key, enabled);
      await audit(req, enabled ? "admin.jobs.source.enable" : "admin.jobs.source.disable", { source: req.params.key });
      res.status(200).json({ data: { sources } });
    } catch (err) {
      next(err);
    }
  },
};
