import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { userRepository } from "../repositories/userRepository.js";

export async function authenticate(req, res, next) {
  let token = null;

  // 1. Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }

  // 2. Check httpOnly cookie
  if (!token && req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    return res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication token missing",
        requestId: req.id || req.headers["x-request-id"] || "req_unknown",
      },
    });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    const user = await userRepository.findById(decoded.userId);

    if (!user || user.isDeleted) {
      return res.status(401).json({
        error: {
          code: "USER_NOT_FOUND",
          message: "User session is no longer active",
          requestId: req.id || req.headers["x-request-id"] || "req_unknown",
        },
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({
      error: {
        code: "INVALID_TOKEN",
        message: err.name === "TokenExpiredError" ? "Session expired" : "Invalid token",
        requestId: req.id || req.headers["x-request-id"] || "req_unknown",
      },
    });
  }
}

export function requireRole(requiredRole) {
  return (req, res, next) => {
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "Insufficient permissions for this resource",
          requestId: req.id || req.headers["x-request-id"] || "req_unknown",
        },
      });
    }
    next();
  };
}
