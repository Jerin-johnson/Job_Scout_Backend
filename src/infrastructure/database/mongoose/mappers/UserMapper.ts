import { UserEntity, IRefreshTokenMeta } from "../../../../domain/entities/User.js";

export class UserMapper {
  static toEntity(doc: unknown): UserEntity | null {
    if (!doc || typeof doc !== "object") return null;
    const raw = doc as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id : raw._id ? String(raw._id) : "";
    const refreshTokensRaw = Array.isArray(raw.refreshTokens) ? raw.refreshTokens : [];

    const refreshTokens: IRefreshTokenMeta[] = refreshTokensRaw.map((item) => {
      const t = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        tokenHash: typeof t.tokenHash === "string" ? t.tokenHash : "",
        familyId: typeof t.familyId === "string" ? t.familyId : "",
        expiresAt: t.expiresAt instanceof Date ? t.expiresAt : new Date(String(t.expiresAt || "")),
        createdAt:
          t.createdAt instanceof Date ? t.createdAt : new Date(String(t.createdAt || Date.now())),
      };
    });

    return {
      id,
      email: typeof raw.email === "string" ? raw.email : "",
      passwordHash: typeof raw.passwordHash === "string" ? raw.passwordHash : null,
      googleId: typeof raw.googleId === "string" ? raw.googleId : null,
      name: typeof raw.name === "string" ? raw.name : "",
      preferredName: typeof raw.preferredName === "string" ? raw.preferredName : "",
      role: typeof raw.role === "string" ? raw.role : "user",
      plan: typeof raw.plan === "string" ? raw.plan : "free",
      planSource: typeof raw.planSource === "string" ? raw.planSource : "manual",
      planVersion: typeof raw.planVersion === "number" ? raw.planVersion : 1,
      profileVersion: typeof raw.profileVersion === "number" ? raw.profileVersion : 1,
      failedLoginAttempts:
        typeof raw.failedLoginAttempts === "number" ? raw.failedLoginAttempts : 0,
      lockUntil:
        raw.lockUntil instanceof Date
          ? raw.lockUntil
          : raw.lockUntil
            ? new Date(String(raw.lockUntil))
            : null,
      refreshTokens,
      memoryPaused: Boolean(raw.memoryPaused),
      isEmailVerified: raw.isEmailVerified !== undefined ? Boolean(raw.isEmailVerified) : true,
      emailVerificationOtpHash:
        typeof raw.emailVerificationOtpHash === "string" ? raw.emailVerificationOtpHash : null,
      emailVerificationOtpExpiresAt:
        raw.emailVerificationOtpExpiresAt instanceof Date
          ? raw.emailVerificationOtpExpiresAt
          : raw.emailVerificationOtpExpiresAt
            ? new Date(String(raw.emailVerificationOtpExpiresAt))
            : null,
      isDeleted: Boolean(raw.isDeleted),
      createdAt:
        raw.createdAt instanceof Date
          ? raw.createdAt
          : new Date(String(raw.createdAt || Date.now())),
      updatedAt:
        raw.updatedAt instanceof Date
          ? raw.updatedAt
          : new Date(String(raw.updatedAt || Date.now())),
    };
  }

  static toPersistence(entity: Partial<UserEntity>): Record<string, unknown> {
    const data: Record<string, unknown> = { ...entity };
    if (data.id) {
      data._id = data.id;
      delete data.id;
    }
    return data;
  }
}
