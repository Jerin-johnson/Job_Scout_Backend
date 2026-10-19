import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../../config/env.js";
import {
  userRepository,
  UserRecord,
} from "../../../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";

interface JwtPayload {
  userId: string;
  [key: string]: unknown;
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<Response | void> {
  let token: string | null = null;

  // 1. Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }

  // 2. Check httpOnly cookie
  if (!token && req.cookies && typeof req.cookies.accessToken === "string") {
    token = req.cookies.accessToken;
  }

  if (!token) {
    return res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication token missing",
        requestId: req.id || (req.headers["x-request-id"] as string) || "req_unknown",
      },
    });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    const user = await userRepository.findById(decoded.userId);

    if (!user || user.isDeleted) {
      return res.status(401).json({
        error: {
          code: "USER_NOT_FOUND",
          message: "User session is no longer active",
          requestId: req.id || (req.headers["x-request-id"] as string) || "req_unknown",
        },
      });
    }

    req.user = user;
    next();
  } catch (err: unknown) {
    const error = err as Error;
    return res.status(401).json({
      error: {
        code: "INVALID_TOKEN",
        message: error.name === "TokenExpiredError" ? "Session expired" : "Invalid token",
        requestId: req.id || (req.headers["x-request-id"] as string) || "req_unknown",
      },
    });
  }
}

export function requireRole(requiredRole: string | string[]) {
  return (req: Request, res: Response, next: NextFunction): Response | void => {
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "Insufficient permissions for this resource",
          requestId: req.id || (req.headers["x-request-id"] as string) || "req_unknown",
        },
      });
    }
    next();
  };
}

export { authMiddleware } from "./authMiddleware.js";
