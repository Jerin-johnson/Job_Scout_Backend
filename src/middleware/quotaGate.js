import { quotaService } from "../services/quotaService.js";
import { createHash } from "node:crypto";

export function requestQuotaIdempotencyKey(req, feature) {
  const supplied = String(req.get?.("Idempotency-Key") || "").trim();
  if (supplied && !/^[A-Za-z0-9._:-]{8,128}$/.test(supplied)) {
    const error = new Error("Idempotency-Key must contain 8-128 safe characters");
    error.statusCode = 400;
    error.code = "INVALID_IDEMPOTENCY_KEY";
    throw error;
  }
  const identity = req.user?._id?.toString() || req.user?.id?.toString() || "anonymous";
  // Request IDs prevent accidental coalescing of two intentional identical actions.
  // Clients should send Idempotency-Key when they need retry/replay protection.
  const source = supplied || req.id || `${Date.now()}:${Math.random()}`;
  return createHash("sha256").update(`${identity}:${feature}:${source}`).digest("hex");
}

export async function acceptRequestQuota(req, feature) {
  const userId = req.user?._id?.toString() || req.user?.id?.toString();
  await quotaService.checkQuota(req.user, feature);
  return quotaService.incrementQuota(
    userId,
    feature,
    requestQuotaIdempotencyKey(req, feature),
    req.user?.plan,
  );
}

export async function acceptQuota(user, feature, idempotencyKey) {
  const userId = user?._id?.toString() || user?.id?.toString();
  await quotaService.checkQuota(user, feature);
  return quotaService.incrementQuota(userId, feature, idempotencyKey, user?.plan);
}

/**
 * Higher-order middleware to enforce feature quota before processing
 * @param {string} feature - e.g. "chat", "tailor_resume", "match_jobs", "interview_prep"
 */
export function requireQuota(feature) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required to check quotas",
          requestId: req.id || req.headers["x-request-id"] || "req_unknown",
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
