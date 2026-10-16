import { env } from "../config/env.js";
import { isTrustedWebOrigin } from "../shared/utils/webOrigin.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfProtection(req, res, next) {
  // Safe HTTP methods do not alter state
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  // Exempt webhooks from CSRF checks (they use cryptographic signature headers)
  if (req.originalUrl.includes("/webhook")) {
    return next();
  }

  // If request is authenticated via Bearer token in header, CSRF is not applicable
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return next();
  }

  // For cookie-based state-changing requests, require custom header & Origin match
  const origin = req.headers.origin;

  // Validate any supplied origin against the same allowlist as CORS.
  const isOriginAllowed = isTrustedWebOrigin(origin, env);

  if (!isOriginAllowed) {
    return res.status(403).json({
      error: {
        code: "CSRF_DETECTED",
        message: "Cross-site request origin is not allowed.",
        requestId: req.id || req.headers["x-request-id"] || "req_unknown",
      },
    });
  }

  next();
}
