import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../types/index.js";
import { appContainer, TOKENS } from "../../../main/container.js";
import { ITokenService } from "../../../domain/security/ITokenService.js";
import { UnauthorizedError } from "../../../application/errors/ApplicationError.js";

export function authMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  const cookies = (req.cookies || {}) as Record<string, string | undefined>;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : cookies.accessToken;

  if (!token) {
    next(new UnauthorizedError("Authentication token is missing"));
    return;
  }

  try {
    const tokenService = appContainer.resolve<ITokenService>(TOKENS.TokenService);
    const payload = tokenService.verifyAccessToken(token);
    req.user = {
      ...payload,
      _id: payload.userId,
      id: payload.userId,
      userId: payload.userId,
    };
    next();
  } catch {
    next(new UnauthorizedError("Invalid or expired authentication token"));
  }
}
