import { injectable, inject } from "tsyringe";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";
import { IAdminRepository } from "../../../domain/repositories/IAdminRepository.js";
import { IUserRepository } from "../../../domain/repositories/IUserRepository.js";
import { IJobRepository } from "../../../domain/repositories/IJobRepository.js";
import { appContainer } from "../../../main/container.js";
import { Request, Response } from "express";
import { getCacheMetrics } from "../../../shared/cache.js";
import { isMongoReady } from "../../../infrastructure/database/database.js";
import { isRedisReady } from "../../../infrastructure/cache/redis.js";
import { jobIngestionService } from "../../../infrastructure/external-services/jobs/ingestion/JobIngestionEngine.js";
import { PLANS, ROLES } from "../../../shared/constants/plans.js";
import mongoose from "mongoose";
import { billingService } from "../../../infrastructure/external-services/billing/billingService.js";
import { adminPersistenceService } from "../../../infrastructure/database/mongoose/repositories/MongooseAdminRepository.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { successResponse, errorResponse } from "../../../shared/types/apiResponse.js";
import {
  updateTrackedCompanySchema,
  updateUserAdminSchema,
  updateJobSourceSchema,
} from "../../../shared/schemas/adminSchemas.js";

interface UserLike {
  _id?: unknown;
  id?: unknown;
  role?: string;
  plan?: string;
  planVersion?: number;
  subscriptionProvider?: string | null;
  subscriptionStatus?: string | null;
  subscriptionId?: string | null;
  [key: string]: unknown;
}

async function audit(
  req: Request,
  action: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const user = req.user as UserLike | undefined;
  await adminPersistenceService.logAudit(
    user?._id || user?.id,
    action,
    req.ip,
    req.get("user-agent"),
    metadata,
  );
}

@injectable()
export class AdminController {
  constructor(
    @inject(TOKENS.AdminRepository)
    private readonly adminRepository: IAdminRepository,
    @inject(TOKENS.UserRepository)
    private readonly userRepository: IUserRepository,
    @inject(TOKENS.JobRepository)
    private readonly jobRepository: IJobRepository,
  ) {}

  listTrackedCompanies = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const statusParam = String(req.query.status || "");
    const status = ["pending", "approved", "disabled"].includes(statusParam)
      ? statusParam
      : undefined;
    const companies = await adminPersistenceService.listTrackedCompanies(status);
    res.json(successResponse({ companies }));
  });

  jobCoverage = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const since = new Date(Date.now() - 30 * 86400000);
    const [coverage, interactionsData] = await Promise.all([
      jobIngestionService.coverageReport(),
      adminPersistenceService.getJobCoverageInteractions(since),
    ]);
    res.json(
      successResponse({
        ...(coverage as Record<string, unknown>),
        interactions: {
          windowDays: 30,
          totalUsers: interactionsData.totalUsers,
          consentedAnalyticsUsers: interactionsData.consentedAnalyticsUsers,
          usersWithZeroEligibleJobs: interactionsData.usersWithZeroEligibleJobs,
          eligibleUserMeasurement:
            "Count of consented pseudonymous users with at least one zero-result event in the 30-day window; not an all-user eligibility census.",
          groups: interactionsData.groups,
        },
      }),
    );
  });

  updateTrackedCompany = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { status } = updateTrackedCompanySchema.parse(req.body);
    const company = await adminPersistenceService.updateTrackedCompanyStatus(
      String(req.params.id),
      status,
    );
    if (!company) {
      res.sendStatus(404);
      return;
    }
    await audit(req, "admin.jobs.company.status", { platform: company.platform, status });
    res.json(successResponse({ company }));
  });

  listJobReports = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const page = Math.max(1, Number.parseInt(String(req.query.page || ""), 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(String(req.query.limit || ""), 10) || 25),
    );
    const { reports, total } = await adminPersistenceService.listJobReports(page, limit);
    res.json(
      successResponse(
        { reports, total, page, limit, pages: Math.ceil(total / limit) },
        { page, limit, total, totalPages: Math.ceil(total / limit) },
      ),
    );
  });

  getMetrics = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const cacheMetrics = getCacheMetrics();
    const telemetry = await adminPersistenceService.getPlatformTelemetry();

    let tierDistribution = {
      tier0: 0,
      tier1: 0,
      tier2: 0,
      tier0Percentage: 0,
      tier1Percentage: 0,
      tier2Percentage: 0,
    };

    const totalTiers = telemetry.tierCounts[0] + telemetry.tierCounts[1] + telemetry.tierCounts[2];
    if (totalTiers > 0) {
      tierDistribution = {
        tier0: telemetry.tierCounts[0],
        tier1: telemetry.tierCounts[1],
        tier2: telemetry.tierCounts[2],
        tier0Percentage: Number(((telemetry.tierCounts[0] / totalTiers) * 100).toFixed(1)),
        tier1Percentage: Number(((telemetry.tierCounts[1] / totalTiers) * 100).toFixed(1)),
        tier2Percentage: Number(((telemetry.tierCounts[2] / totalTiers) * 100).toFixed(1)),
      };
    }

    await audit(req, "admin.metrics.read");
    res.status(200).json(
      successResponse({
        uptimeSeconds: Math.round(process.uptime()),
        status: isMongoReady() && isRedisReady() ? "healthy" : "degraded",
        totals: { users: telemetry.userCount, jobs: telemetry.jobCount },
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
          meetsTarget: tierDistribution.tier0Percentage + tierDistribution.tier1Percentage >= 70.0,
        },
        costTelemetry: {
          todayCostUsd: telemetry.todayCostUsd,
          dailyBudgetCapUsd: Number(process.env.GLOBAL_DAILY_USD_CAP || 500),
          spendRatioPercent: Number(
            (
              (telemetry.todayCostUsd / Number(process.env.GLOBAL_DAILY_USD_CAP || 500)) *
              100
            ).toFixed(2),
          ),
        },
        queues: {
          ingestJobs: { depth: null, status: "not_configured" },
          dailyMatch: { depth: null, status: "not_configured" },
          sendEmailDigest: { depth: null, status: "not_configured" },
          sendFollowUp: { depth: null, status: "not_configured" },
        },
      }),
    );
  });

  listUsers = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!isMongoReady()) {
      res
        .status(503)
        .json(
          errorResponse(
            "DATABASE_UNAVAILABLE",
            "User directory requires MongoDB",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    const page = Math.max(1, Number.parseInt(String(req.query.page || ""), 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(String(req.query.limit || ""), 10) || 25),
    );
    const q = String(req.query.q || "").trim();
    const { users, total } = await adminPersistenceService.listUsers(page, limit, q);
    await audit(req, "admin.users.list", { page, limit, query: Boolean(q) });
    res
      .status(200)
      .json(
        successResponse(
          { users, total, page, limit, pages: Math.ceil(total / limit) },
          { page, limit, total, totalPages: Math.ceil(total / limit) },
        ),
      );
  });

  updateUser = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!isMongoReady()) {
      res
        .status(503)
        .json(
          errorResponse(
            "DATABASE_UNAVAILABLE",
            "User management requires MongoDB",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    const parsed = updateUserAdminSchema.safeParse(req.body);
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
    const targetUserId = String(req.params.id);
    if (!mongoose.isValidObjectId(targetUserId)) {
      res
        .status(404)
        .json(errorResponse("NOT_FOUND", "User not found", req.id ? String(req.id) : undefined));
      return;
    }
    const target = (await adminPersistenceService.findUserById(targetUserId)) as UserLike | null;
    if (!target) {
      res
        .status(404)
        .json(errorResponse("NOT_FOUND", "User not found", req.id ? String(req.id) : undefined));
      return;
    }

    const adminUser = req.user as UserLike | undefined;
    const adminUserId = String(adminUser?._id || adminUser?.id || "");
    const targetIdStr = String(target._id || target.id || "");

    if (targetIdStr === adminUserId && parsed.data.role && parsed.data.role !== ROLES.SUPER_ADMIN) {
      res
        .status(409)
        .json(
          errorResponse(
            "SELF_DEMOTION_BLOCKED",
            "You cannot remove your own super administrator access",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }

    if (
      target.role === ROLES.SUPER_ADMIN &&
      parsed.data.role &&
      parsed.data.role !== ROLES.SUPER_ADMIN
    ) {
      const superAdminCount = await adminPersistenceService.countSuperAdmins();
      if (superAdminCount <= 1) {
        res
          .status(409)
          .json(
            errorResponse(
              "LAST_SUPER_ADMIN",
              "At least one super administrator must remain",
              req.id ? String(req.id) : undefined,
            ),
          );
        return;
      }
    }

    if (
      parsed.data.plan &&
      parsed.data.plan !== target.plan &&
      target.subscriptionProvider === "razorpay" &&
      ["active", "past_due"].includes(target.subscriptionStatus as string)
    ) {
      res
        .status(409)
        .json(
          errorResponse(
            "ACTIVE_PROVIDER_SUBSCRIPTION",
            "This user has an active or past-due Razorpay subscription. Change or cancel it in Razorpay before applying a manual plan override.",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }

    const updates: Record<string, unknown> = { ...parsed.data };
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

    const updated = await adminPersistenceService.updateUserById(targetUserId, updates);
    await audit(req, "admin.user.update", {
      targetUserId,
      changes: parsed.data,
    });
    res.status(200).json(successResponse({ user: updated }));
  });

  billingOverview = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!isMongoReady()) {
      res
        .status(503)
        .json(
          errorResponse(
            "DATABASE_UNAVAILABLE",
            "Billing reports require MongoDB",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 30);
    const overview = await adminPersistenceService.getBillingOverview(since);
    await audit(req, "admin.billing.overview.read");
    res.status(200).json(
      successResponse({
        windowDays: 30,
        ...overview,
      }),
    );
  });

  listSubscriptions = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!isMongoReady()) {
      res
        .status(503)
        .json(
          errorResponse(
            "DATABASE_UNAVAILABLE",
            "Subscription records require MongoDB",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(String(req.query.limit || ""), 10) || 25),
    );
    const subscriptions = await adminPersistenceService.listSubscriptions(limit);
    await audit(req, "admin.billing.subscriptions.list", { limit });
    res.status(200).json(successResponse({ subscriptions }));
  });

  cancelSubscription = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!isMongoReady()) {
      res
        .status(503)
        .json(
          errorResponse(
            "DATABASE_UNAVAILABLE",
            "Subscription records require MongoDB",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    const subId = String(req.params.id);
    if (!mongoose.isValidObjectId(subId)) {
      res
        .status(404)
        .json(
          errorResponse("NOT_FOUND", "Subscription not found", req.id ? String(req.id) : undefined),
        );
      return;
    }
    interface SubscriptionRecord {
      _id: unknown;
      provider?: string;
      status?: string;
      cancelAtPeriodEnd?: boolean;
      subscriptionId?: string;
      userId?: unknown;
    }
    const subscription = (await adminPersistenceService.findSubscriptionById(
      subId,
    )) as SubscriptionRecord | null;
    if (!subscription) {
      res
        .status(404)
        .json(
          errorResponse("NOT_FOUND", "Subscription not found", req.id ? String(req.id) : undefined),
        );
      return;
    }
    if (subscription.provider !== "razorpay" || subscription.status !== "active") {
      res
        .status(409)
        .json(
          errorResponse(
            "SUBSCRIPTION_NOT_ACTIVE",
            "Only active Razorpay subscriptions can be cancelled",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    if (subscription.cancelAtPeriodEnd) {
      res
        .status(409)
        .json(
          errorResponse(
            "CANCELLATION_ALREADY_SCHEDULED",
            "Cancellation is already scheduled",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    const result = await billingService.cancelSubscription(
      subscription.subscriptionId as string,
      true,
    );
    await adminPersistenceService.markSubscriptionCancelAtPeriodEnd(subId);
    await audit(req, "admin.billing.subscription.cancel_scheduled", {
      subscriptionId: subscription.subscriptionId,
      userId: String(subscription.userId),
    });
    res.status(200).json(
      successResponse({
        message: "Subscription cancellation scheduled for the end of the billing period",
        subscription: result,
      }),
    );
  });

  listPayments = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!isMongoReady()) {
      res
        .status(503)
        .json(
          errorResponse(
            "DATABASE_UNAVAILABLE",
            "Payment records require MongoDB",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    const page = Math.max(1, Number.parseInt(String(req.query.page || ""), 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(String(req.query.limit || ""), 10) || 25),
    );
    const { payments, total } = await adminPersistenceService.listPayments(page, limit);
    await audit(req, "admin.billing.payments.list", { page, limit });
    res
      .status(200)
      .json(
        successResponse(
          { payments, total, page, limit, pages: Math.ceil(total / limit) },
          { page, limit, total, totalPages: Math.ceil(total / limit) },
        ),
      );
  });

  refundPayment = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!isMongoReady()) {
      res
        .status(503)
        .json(
          errorResponse(
            "DATABASE_UNAVAILABLE",
            "Payment records require MongoDB",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    interface PaymentRecord {
      _id: unknown;
      providerPaymentId: string;
      status: string;
      amountMinor: number;
      amountRefundedMinor: number;
    }
    const payment = (await adminPersistenceService.findPaymentByProviderPaymentId(
      String(req.params.paymentId),
    )) as PaymentRecord | null;

    if (!payment) {
      res
        .status(404)
        .json(errorResponse("NOT_FOUND", "Payment not found", req.id ? String(req.id) : undefined));
      return;
    }
    if (!["captured", "partially_refunded"].includes(payment.status)) {
      res
        .status(409)
        .json(
          errorResponse(
            "PAYMENT_NOT_REFUNDABLE",
            "Payment is not currently refundable",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    const remaining = payment.amountMinor - payment.amountRefundedMinor;
    if (remaining <= 0) {
      res
        .status(409)
        .json(
          errorResponse(
            "PAYMENT_ALREADY_REFUNDED",
            "No refundable balance remains",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }

    const previousStatus = payment.status;
    const claimed = await adminPersistenceService.claimPaymentRefund(
      payment._id,
      previousStatus,
      payment.amountRefundedMinor,
    );
    if (!claimed) {
      res
        .status(409)
        .json(
          errorResponse(
            "REFUND_ALREADY_IN_PROGRESS",
            "Another refund request is already in progress",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }

    try {
      const adminUser = req.user as UserLike | undefined;
      interface RefundResult {
        id: string;
        [key: string]: unknown;
      }
      const refund = (await billingService.refundPayment(payment.providerPaymentId, remaining, {
        initiated_by: "super_admin",
        admin_user_id: String(adminUser?._id || adminUser?.id || ""),
      })) as unknown as RefundResult;

      await audit(req, "admin.billing.payment.refund_requested", {
        paymentId: payment.providerPaymentId,
        amountMinor: remaining,
        refundId: refund.id,
      });

      res.status(202).json(
        successResponse({
          message:
            "Refund requested from Razorpay; the ledger will update when its webhook arrives",
          refundId: refund.id,
        }),
      );
    } catch (err) {
      await adminPersistenceService.revertPaymentStatus(payment._id, previousStatus);
      throw err;
    }
  });

  listJobs = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const result = await jobIngestionService.searchJobs({
      q: String(req.query.q || "").trim(),
      source: String(req.query.source || "").trim(),
      page: Math.max(1, Number.parseInt(String(req.query.page || ""), 10) || 1),
      limit: Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || ""), 10) || 25)),
    });
    await audit(req, "admin.jobs.list", { page: result.page });
    res.status(200).json(successResponse(result));
  });

  listAudit = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!isMongoReady()) {
      res
        .status(503)
        .json(
          errorResponse(
            "DATABASE_UNAVAILABLE",
            "Admin audit history requires MongoDB",
            req.id ? String(req.id) : undefined,
          ),
        );
      return;
    }
    const page = Math.max(1, Number.parseInt(String(req.query.page || ""), 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(String(req.query.limit || ""), 10) || 25),
    );
    const { events, total } = await adminPersistenceService.listAuditLogs(page, limit);
    res
      .status(200)
      .json(
        successResponse(
          { events, total, page, limit, pages: Math.ceil(total / limit) },
          { page, limit, total, totalPages: Math.ceil(total / limit) },
        ),
      );
  });

  listJobSources = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    const sources = await jobIngestionService.sourceBudgets();
    res.status(200).json(successResponse({ sources }));
  });

  updateJobSource = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const input = updateJobSourceSchema.parse(req.body);
    let sources: unknown;
    const sourceKey = Array.isArray(req.params.key)
      ? req.params.key[0] || ""
      : req.params.key || "";
    if (input.approved !== undefined) {
      sources = await jobIngestionService.setSourceApproved(sourceKey, input.approved);
    }
    if (input.enabled !== undefined) {
      sources = await jobIngestionService.setSourceEnabled(sourceKey, input.enabled);
    }
    await audit(
      req,
      input.approved !== undefined
        ? input.approved
          ? "admin.jobs.source.approve"
          : "admin.jobs.source.unapprove"
        : input.enabled
          ? "admin.jobs.source.enable"
          : "admin.jobs.source.disable",
      { source: req.params.key },
    );
    res.status(200).json(successResponse({ sources }));
  });
}

export const adminController = new Proxy({} as AdminController, {
  get(_target, prop) {
    const instance = appContainer.resolve(AdminController);
    const value = (instance as unknown as Record<string, unknown>)[prop as string];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(instance)
      : value;
  },
});
