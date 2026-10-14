import { quotaService } from "../services/quotaService.js";

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
