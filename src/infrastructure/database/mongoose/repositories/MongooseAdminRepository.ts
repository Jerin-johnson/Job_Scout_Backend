import { injectable } from "tsyringe";
import { IAdminRepository } from "../../../../domain/repositories/IAdminRepository.js";
import mongoose from "mongoose";
import { isMongoReady } from "../../database.js";
import { logger } from "../../../../shared/utils/logger.js";
import { RoutingLog } from "../models/RoutingLogModel.js";
import { UsageEvent } from "../models/UsageEventModel.js";
import { User } from "../models/UserModel.js";
import { Job } from "../models/JobModel.js";
import { AuditLog } from "../models/AuditLogModel.js";
import { Subscription } from "../models/SubscriptionModel.js";
import { Payment } from "../models/PaymentModel.js";
import { TrackedCompany } from "../models/TrackedCompanyModel.js";
import { InteractionEvent } from "../models/InteractionEventModel.js";
import { ROLES } from "../../../../shared/constants/plans.js";

export interface JobWithReports {
  _id: string;
  title?: string;
  company?: string;
  sourceBoard?: string;
  sourceUrl?: string;
  reportCounts?: [string, number][] | Record<string, number>;
}

export const adminPersistenceService = {
  async logAudit(
    userId: unknown,
    action: string,
    ipAddress?: string,
    userAgent?: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    if (!isMongoReady()) return;
    await AuditLog.create({
      userId,
      action,
      ipAddress,
      userAgent,
      metadata,
    }).catch((err: Error) =>
      logger.error({ err: err.message, action }, "Failed to write admin audit log"),
    );
  },

  async listTrackedCompanies(status?: string): Promise<Record<string, unknown>[]> {
    return (await TrackedCompany.find(status ? { status } : {})
      .select("platform slug careersUrl status verifiedAt createdAt")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()) as Record<string, unknown>[];
  },

  async updateTrackedCompanyStatus(
    id: string,
    status: string,
  ): Promise<Record<string, unknown> | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    return (await TrackedCompany.findByIdAndUpdate(id, { $set: { status } }, { new: true })
      .select("platform slug careersUrl status verifiedAt createdAt")
      .lean()) as Record<string, unknown> | null;
  },

  async getJobCoverageInteractions(since: Date): Promise<{
    groups: unknown[];
    totalUsers: number;
    consentedAnalyticsUsers: number;
    usersWithZeroEligibleJobs: number;
  }> {
    const [interactions, profiles, consentedActorKeys, zeroResultActorKeys] = await Promise.all([
      InteractionEvent.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: {
              event: "$event",
              source: "$source",
              occupation: "$occupation",
              country: "$country",
              scoreBand: "$scoreBand",
            },
            count: { $sum: "$count" },
          },
        },
        { $sort: { "_id.event": 1, count: -1 } },
      ]).option({ maxTimeMS: 1500 }),
      User.countDocuments({ isDeleted: false }),
      InteractionEvent.distinct("actorKey", { createdAt: { $gte: since } }),
      InteractionEvent.distinct("actorKey", { event: "zero_result", createdAt: { $gte: since } }),
    ]);

    return {
      groups: interactions,
      totalUsers: profiles,
      consentedAnalyticsUsers: consentedActorKeys.length,
      usersWithZeroEligibleJobs: zeroResultActorKeys.length,
    };
  },

  async listJobReports(
    page: number,
    limit: number,
  ): Promise<{ reports: unknown[]; total: number }> {
    const reported = {
      $or: ["expired", "broken_link", "misleading", "spam", "other"].map((reason) => ({
        [`reportCounts.${reason}`]: { $gt: 0 },
      })),
    };

    const [jobs, total] = await Promise.all([
      Job.find(reported)
        .select("title company sourceBoard sourceUrl reportCounts")
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean() as Promise<JobWithReports[]>,
      Job.countDocuments(reported),
    ]);

    const reports = jobs.map((job) => ({
      jobId: {
        _id: job._id,
        title: job.title,
        company: job.company,
        sourceBoard: job.sourceBoard,
        sourceUrl: job.sourceUrl,
      },
      reasonCounts: Array.isArray(job.reportCounts)
        ? Object.fromEntries(job.reportCounts)
        : job.reportCounts || {},
    }));

    return { reports, total };
  },

  async getPlatformTelemetry(): Promise<{
    tierCounts: Record<number, number>;
    todayCostUsd: number;
    userCount: number | null;
    jobCount: number | null;
  }> {
    const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    let todayCostUsd = 0;

    if (isMongoReady()) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const [logs, spend, userCount, jobCount] = await Promise.all([
        RoutingLog.aggregate([
          { $match: { createdAt: { $gte: startOfDay } } },
          { $group: { _id: "$tier", count: { $sum: 1 } } },
        ]),
        UsageEvent.aggregate([
          { $match: { createdAt: { $gte: startOfDay } } },
          { $group: { _id: null, totalCost: { $sum: "$costUsd" } } },
        ]),
        User.countDocuments({ isDeleted: false }),
        Job.countDocuments({ expiresAt: { $gt: new Date() } }),
      ]);

      for (const l of logs) {
        counts[l._id as number] = l.count;
      }
      if (spend.length > 0) {
        todayCostUsd = Number(spend[0].totalCost.toFixed(4));
      }

      return { tierCounts: counts, todayCostUsd, userCount, jobCount };
    }

    return { tierCounts: counts, todayCostUsd, userCount: null, jobCount: null };
  },

  async listUsers(
    page: number,
    limit: number,
    q: string = "",
  ): Promise<{ users: unknown[]; total: number }> {
    const filter: Record<string, unknown> = { isDeleted: false };
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [{ email: new RegExp(escaped, "i") }, { name: new RegExp(escaped, "i") }];
    }

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

    return { users, total };
  },

  async findUserById(id: string): Promise<Record<string, unknown> | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    return (await User.findOne({
      _id: id,
      isDeleted: false,
    }).lean()) as Record<string, unknown> | null;
  },

  async countSuperAdmins(): Promise<number> {
    return await User.countDocuments({
      role: ROLES.SUPER_ADMIN,
      isDeleted: false,
    });
  },

  async updateUserById(
    id: string,
    updates: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    return (await User.findByIdAndUpdate(id, { $set: updates }, { new: true })
      .select(
        "name email role plan planSource subscriptionProvider subscriptionStatus subscriptionId createdAt",
      )
      .lean()) as Record<string, unknown> | null;
  },

  async getBillingOverview(since: Date): Promise<{
    revenue: unknown[];
    totalPayments: number;
    activeSubscriptions: number;
    pastDueSubscriptions: number;
    scheduledCancellations: number;
    subscriptionsByPlan: Record<string, number>;
    paymentsByStatus: Record<string, number>;
  }> {
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

    return {
      revenue,
      totalPayments,
      activeSubscriptions,
      pastDueSubscriptions,
      scheduledCancellations,
      subscriptionsByPlan: Object.fromEntries(
        subscriptionsByPlan.map((item: { _id: string; count: number }) => [item._id, item.count]),
      ),
      paymentsByStatus: Object.fromEntries(
        paymentsByStatus.map((item: { _id: string; count: number }) => [item._id, item.count]),
      ),
    };
  },

  async listSubscriptions(limit: number): Promise<unknown[]> {
    return await Subscription.find()
      .populate("userId", "name email")
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
  },

  async findSubscriptionById(id: string): Promise<Record<string, unknown> | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    return (await Subscription.findById(id).lean()) as Record<string, unknown> | null;
  },

  async markSubscriptionCancelAtPeriodEnd(id: string): Promise<void> {
    await Subscription.updateOne({ _id: id }, { $set: { cancelAtPeriodEnd: true } });
  },

  async listPayments(page: number, limit: number): Promise<{ payments: unknown[]; total: number }> {
    const [payments, total] = await Promise.all([
      Payment.find()
        .populate("userId", "name email")
        .sort({ paidAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Payment.countDocuments(),
    ]);
    return { payments, total };
  },

  async findPaymentByProviderPaymentId(paymentId: string): Promise<Record<string, unknown> | null> {
    return (await Payment.findOne({
      providerPaymentId: paymentId,
    }).lean()) as Record<string, unknown> | null;
  },

  async claimPaymentRefund(
    id: unknown,
    currentStatus: string,
    amountRefundedMinor: number,
  ): Promise<boolean> {
    const claimed = await Payment.findOneAndUpdate(
      {
        _id: id,
        status: currentStatus,
        amountRefundedMinor,
      },
      { $set: { status: "refund_pending" } },
      { new: true },
    );
    return Boolean(claimed);
  },

  async revertPaymentStatus(id: unknown, fallbackStatus: string): Promise<void> {
    await Payment.updateOne(
      { _id: id, status: "refund_pending" },
      { $set: { status: fallbackStatus } },
    );
  },

  async listAuditLogs(page: number, limit: number): Promise<{ events: unknown[]; total: number }> {
    const [events, total] = await Promise.all([
      AuditLog.find()
        .populate("userId", "name email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(),
    ]);
    return { events, total };
  },
};

@injectable()
export class MongooseAdminRepository implements IAdminRepository {
  async logAudit(
    userId: unknown,
    action: string,
    ipAddress?: string,
    userAgent?: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    return adminPersistenceService.logAudit(userId, action, ipAddress, userAgent, metadata);
  }
  async listTrackedCompanies(status?: string): Promise<Record<string, unknown>[]> {
    return adminPersistenceService.listTrackedCompanies(status);
  }
  async updateTrackedCompanyStatus(
    id: string,
    status: string,
  ): Promise<Record<string, unknown> | null> {
    return adminPersistenceService.updateTrackedCompanyStatus(id, status);
  }
  async getJobCoverageInteractions(since: Date): Promise<Record<string, unknown>> {
    return adminPersistenceService.getJobCoverageInteractions(since);
  }
  async listJobReports(page = 1, limit = 20): Promise<{ reports: unknown[]; total: number }> {
    return adminPersistenceService.listJobReports(page, limit);
  }
  async getPlatformTelemetry(): Promise<Record<string, unknown>> {
    return adminPersistenceService.getPlatformTelemetry();
  }
  async listUsers(page = 1, limit = 50): Promise<{ users: unknown[]; total: number }> {
    return adminPersistenceService.listUsers(page, limit);
  }
  async findUserById(id: string): Promise<Record<string, unknown> | null> {
    return adminPersistenceService.findUserById(id);
  }
  async countSuperAdmins(): Promise<number> {
    return adminPersistenceService.countSuperAdmins();
  }
  async updateUserById(
    id: string,
    updates: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    return adminPersistenceService.updateUserById(id, updates);
  }
  async getBillingOverview(since: Date): Promise<Record<string, unknown>> {
    return adminPersistenceService.getBillingOverview(since);
  }
  async listSubscriptions(limit = 100): Promise<unknown[]> {
    return adminPersistenceService.listSubscriptions(limit);
  }
  async findSubscriptionById(id: string): Promise<Record<string, unknown> | null> {
    return adminPersistenceService.findSubscriptionById(id);
  }
  async markSubscriptionCancelAtPeriodEnd(id: string): Promise<void> {
    return adminPersistenceService.markSubscriptionCancelAtPeriodEnd(id);
  }
  async listPayments(page = 1, limit = 20): Promise<{ payments: unknown[]; total: number }> {
    return adminPersistenceService.listPayments(page, limit);
  }
  async findPaymentByProviderPaymentId(paymentId: string): Promise<Record<string, unknown> | null> {
    return adminPersistenceService.findPaymentByProviderPaymentId(paymentId);
  }
  async claimPaymentRefund(
    id: unknown,
    currentStatus: string,
    amountRefundedMinor: number,
  ): Promise<boolean> {
    return adminPersistenceService.claimPaymentRefund(id, currentStatus, amountRefundedMinor);
  }
  async revertPaymentStatus(id: unknown, fallbackStatus: string): Promise<void> {
    return adminPersistenceService.revertPaymentStatus(id, fallbackStatus);
  }
  async listAuditLogs(page = 1, limit = 50): Promise<{ events: unknown[]; total: number }> {
    return adminPersistenceService.listAuditLogs(page, limit);
  }
}
export const adminRepository = new MongooseAdminRepository();
