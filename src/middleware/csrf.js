import { env } from "../config/env.js";

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
  const requestedWith = req.headers["x-requested-with"];
  const secFetchSite = req.headers["sec-fetch-site"];
  const origin = req.headers.origin;

  // Custom header defense (browsers prevent cross-origin scripts from setting custom headers without CORS preflight)
  const hasCustomHeader =
    requestedWith === "XMLHttpRequest" ||
    requestedWith === "JobScoutClient" ||
    secFetchSite === "same-origin";

  // Validate origin if present
  const isOriginAllowed = !origin || origin === env.WEB_ORIGIN;

  if (!hasCustomHeader && !isOriginAllowed) {
    return res.status(403).json({
      error: {
        code: "CSRF_DETECTED",
        message: "Cross-site request forgery protection triggered. Missing required headers.",
        requestId: req.id || req.headers["x-request-id"] || "req_unknown",
      },
    });
  }

  next();
}
