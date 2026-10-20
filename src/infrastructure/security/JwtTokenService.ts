import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { injectable } from "tsyringe";
import { ITokenService, ITokenPayload } from "../../domain/security/ITokenService.js";
import { env } from "../../config/env.js";

@injectable()
export class JwtTokenService implements ITokenService {
  generateAccessToken(payload: ITokenPayload): string {
    return jwt.sign(
      {
        userId: payload.userId,
        role: payload.role,
        plan: payload.plan,
      },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "15m" },
    );
  }

  generateRefreshToken(payload: ITokenPayload): string {
    return jwt.sign(
      {
        userId: payload.userId,
        familyId: payload.familyId || crypto.randomUUID(),
        jti: crypto.randomUUID(),
      },
      env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" },
    );
  }

  verifyAccessToken(token: string): ITokenPayload {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as Record<string, unknown>;
    return {
      userId: String(decoded.userId || ""),
      role: String(decoded.role || "user"),
      plan: String(decoded.plan || "free"),
    };
  }

  verifyRefreshToken(token: string): ITokenPayload {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as Record<string, unknown>;
    return {
      userId: String(decoded.userId || ""),
      role: String(decoded.role || "user"),
      plan: String(decoded.plan || "free"),
      familyId: typeof decoded.familyId === "string" ? decoded.familyId : undefined,
    };
  }
}
