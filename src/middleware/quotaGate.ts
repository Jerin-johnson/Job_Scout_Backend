import { Request, Response, NextFunction } from "express";
import { quotaService } from "../services/quotaService.js";
import { createHash } from "node:crypto";
import { UserRecord } from "../repositories/userRepository.js";
import { PlanType, PLANS } from "../shared/constants/plans.js";

interface CustomStatusError extends Error {
  statusCode?: number;
  code?: string;
}

export function requestQuotaIdempotencyKey(req: Request, feature: string): string {
  const supplied = String(req.get?.("Idempotency-Key") || "").trim();
  if (supplied && !/^[A-Za-z0-9._:-]{8,128}$/.test(supplied)) {
    const error: CustomStatusError = new Error("Idempotency-Key must contain 8-128 safe characters");
    error.statusCode = 400;
    error.code = "INVALID_IDEMPOTENCY_KEY";
    throw error;
  }
  const identity = req.user?._id?.toString() || (req.user as unknown as { id?: string })?.id?.toString() || "anonymous";
  // Request IDs prevent accidental coalescing of two intentional identical actions.
  // Clients should send Idempotency-Key when they need retry/replay protection.
  const source = supplied || req.id || `${Date.now()}:${Math.random()}`;
  return createHash("sha256").update(`${identity}:${feature}:${source}`).digest("hex");
}

export async function acceptRequestQuota(req: Request, feature: string): Promise<unknown> {
  const userId = req.user?._id?.toString() || (req.user as unknown as { id?: string })?.id?.toString() || "";
  await quotaService.checkQuota(req.user, feature);
  return quotaService.incrementQuota(
    userId,
    feature,
    requestQuotaIdempotencyKey(req, feature),
    (req.user?.plan as "free") || PLANS.FREE,
  );
}

export async function acceptQuota(user: UserRecord | undefined, feature: string, idempotencyKey: string): Promise<unknown> {
  const userId = user?._id?.toString() || (user as unknown as { id?: string })?.id?.toString() || "";
  await quotaService.checkQuota(user, feature);
  return quotaService.incrementQuota(
    userId,
    feature,
    idempotencyKey,
    (user?.plan as "free") || PLANS.FREE,
  );
}

/**
 * Higher-order middleware to enforce feature quota before processing
 * @param feature - e.g. "chat", "tailor_resume", "match_jobs", "interview_prep"
 */
export function requireQuota(feature: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required to check quotas",
          requestId: req.id || (req.headers["x-request-id"] as string) || "req_unknown",
        },
      });
    }

    try {
      await quotaService.checkQuota(req.user, feature);
      next();
    } catch (err) {
      next(err);
    }
  };
}
